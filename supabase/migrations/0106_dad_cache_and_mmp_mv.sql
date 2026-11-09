-- Speed up the DAD's slow tabs (2026-11-09).
--
-- 1. dad_cache: precomputed API payloads (src/lib/dad-cache.ts). The slow
--    tabs recomputed from tens of thousands of raw rows on every visit; now
--    they read one row and refresh it in the background.
-- 2. mmp_snapshot_mv: the mmp_snapshot view takes ~5 s and sometimes more
--    than PostgREST's 8 s statement timeout, which broke the MMP tab
--    ("canceling statement due to statement timeout"). A materialized copy,
--    refreshed every 15 minutes by pg_cron, reads instantly.
-- 3. dad_warm_cache_tick: pg_cron calls /api/cron/warm-cache every 10 minutes
--    so nobody opens a slow tab on a cold or stale copy. It reuses the Vault
--    secrets the Support Inbox poll already has (support_poll_url for the
--    host, support_cron_secret = CRON_SECRET) and no-ops without them.

-- 1. Cache table --------------------------------------------------------------
create table if not exists public.dad_cache (
  key text primary key,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  compute_ms integer
);

comment on table public.dad_cache is
  'DAD precomputed API payloads (src/lib/dad-cache.ts). Safe to truncate: every row is recomputed on demand. Service-role only.';

alter table public.dad_cache enable row level security;
revoke all on public.dad_cache from anon, authenticated;

-- 2. MMP snapshot, materialized ---------------------------------------------
create materialized view if not exists public.mmp_snapshot_mv as
  select * from public.mmp_snapshot;

comment on materialized view public.mmp_snapshot_mv is
  'Copy of mmp_snapshot (one row) refreshed every 15 min by pg_cron; the view itself can exceed PostgREST''s 8 s timeout.';

revoke all on public.mmp_snapshot_mv from anon, authenticated;
grant select on public.mmp_snapshot_mv to service_role;

create or replace function public.refresh_mmp_snapshot_mv()
returns void
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
begin
  refresh materialized view public.mmp_snapshot_mv;
end;
$$;

revoke all on function public.refresh_mmp_snapshot_mv() from public, anon, authenticated;

-- cron.schedule upserts by jobname, so re-applying this file is safe.
select cron.schedule('refresh-mmp-snapshot', '*/15 * * * *', 'select public.refresh_mmp_snapshot_mv()');

-- 3. Warm the DAD cache -------------------------------------------------------
create or replace function public.dad_warm_cache_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  poll_url text;
  cron_secret text;
  base text;
begin
  select decrypted_secret into poll_url
    from vault.decrypted_secrets where name = 'support_poll_url';
  select decrypted_secret into cron_secret
    from vault.decrypted_secrets where name = 'support_cron_secret';
  if poll_url is null or cron_secret is null then
    return; -- secrets not seeded: see migration 0063
  end if;
  -- https://<host>/api/cron/support-poll -> https://<host>
  base := substring(poll_url from '^(https?://[^/]+)');
  if base is null then
    return;
  end if;
  perform net.http_get(
    url := base || '/api/cron/warm-cache',
    headers := jsonb_build_object('Authorization', 'Bearer ' || cron_secret),
    timeout_milliseconds := 300000
  );
end;
$$;

comment on function public.dad_warm_cache_tick() is
  'Fires the DAD warm-cache endpoint (recomputes the slow tabs). pg_cron, every 10 min; reuses the support-poll Vault secrets.';

revoke all on function public.dad_warm_cache_tick() from public, anon, authenticated;

select cron.schedule('dad-warm-cache', '*/10 * * * *', 'select public.dad_warm_cache_tick()');
