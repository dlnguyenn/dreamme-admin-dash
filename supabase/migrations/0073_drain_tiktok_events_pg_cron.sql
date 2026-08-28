-- WHY: Vercel began enforcing the Hobby-plan "daily crons only" rule at
-- deployment time on 2026-08-28 (the 04:41 UTC deploy passed, the 05:06 UTC
-- deploy of the SAME vercel.json failed validation) — so the */5 * * * *
-- drain-tiktok-events entry blocked every subsequent deployment. Move the
-- 5-minute drain to pg_cron + pg_net, the proven support_poll_tick pattern;
-- the vercel.json entry drops to a daily backup sweep.
--
-- Auth reuses support_cron_secret (= the dash CRON_SECRET; the route checks
-- checkCronAuth, same as support-poll). URL seeded idempotently below.

create or replace function public.drain_tiktok_events_tick()
returns void
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  drain_url text;
  cron_secret text;
begin
  select decrypted_secret into drain_url
    from vault.decrypted_secrets where name = 'drain_tiktok_events_url';
  select decrypted_secret into cron_secret
    from vault.decrypted_secrets where name = 'support_cron_secret';
  if drain_url is null or cron_secret is null then
    return; -- secrets not seeded — no-op, same convention as support_poll_tick
  end if;
  perform net.http_get(
    url := drain_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || cron_secret),
    timeout_milliseconds := 60000  -- route maxDuration is 60s
  );
end;
$fn$;

do $seed$
begin
  if not exists (select 1 from vault.secrets where name = 'drain_tiktok_events_url') then
    perform vault.create_secret(
      'https://dreamme-admin-dash.vercel.app/api/cron/drain-tiktok-events',
      'drain_tiktok_events_url'
    );
  end if;
end $seed$;

-- cron.schedule upserts by jobname, so re-running is safe.
select cron.schedule(
  'drain-tiktok-events',
  '*/5 * * * *',
  'select public.drain_tiktok_events_tick()'
);
