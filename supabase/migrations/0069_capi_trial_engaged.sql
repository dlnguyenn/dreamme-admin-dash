-- trial_engaged → Meta CAPI (server-side qualified-trial signal).
--
-- Why: our ad sets optimize START_TRIAL on 1-day click attribution, but the
-- signal Meta should really chase is the trial that touches the medical-logging
-- core. 63-65% of trialers log a meal/weight/dose within hours of trial start
-- (2026-08-27 sizing: 58.5% inside 30 min, 64.9% inside 4h ≈ 180/wk), and that
-- behavior is our known conversion driver. SKAN CV 59 ("trial_engaged") was
-- designed for this but has fired 0 times in 3,012 postbacks — it needs an app
-- release. This pipeline sends the same event server-side via the Conversions
-- API instead: no app release, matched via hashed email, inside the 1d window
-- because we send the moment the qualifying log appears (4h deadline).
--
-- Audit/dedupe table: one row per trial (original_transaction_id). The cron
-- route inserts 'sent' rows after a successful CAPI post and terminal
-- 'no_*' rows once the 4h window has expired, so each trial is decided once.
create table if not exists public.capi_trial_engaged_log (
  original_transaction_id text primary key,
  app_user_id text not null,
  store text,
  trial_started_at timestamptz not null,
  engaged_at timestamptz,          -- min(created_at) of the qualifying log; null for no_engagement
  status text not null check (status in ('sent','no_engagement','no_user_map','no_email','send_failed')),
  meta_response jsonb,             -- CAPI response body (events_received / error) for 'sent'/'send_failed'
  created_at timestamptz not null default now()
);

comment on table public.capi_trial_engaged_log is
  'Dedupe + audit for server-side trial_engaged CAPI events. Engaged = meal/body/injection log within 4h of trial start (matches the intended SKAN CV 59 definition; 4h chosen 2026-08-27 for 1d-click attribution).';

alter table public.capi_trial_engaged_log enable row level security;
-- service-role only; the dashboard reads it through owner-rights views if ever needed.

-- ---- pg_cron: tick the dash route every 15 minutes ----
-- Same pattern as 0063 (support poll): read url + secret from Vault, no-op
-- silently until both are seeded. One-time seeding in the SQL editor:
--
--   select vault.create_secret('https://<prod-domain>/api/cron/capi-trial-engaged', 'capi_trial_engaged_url');
--   -- reuses the existing CRON_SECRET value:
--   select vault.create_secret('<CRON_SECRET value>', 'capi_trial_engaged_secret');
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.capi_trial_engaged_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  tick_url text;
  tick_secret text;
begin
  select decrypted_secret into tick_url
    from vault.decrypted_secrets where name = 'capi_trial_engaged_url';
  select decrypted_secret into tick_secret
    from vault.decrypted_secrets where name = 'capi_trial_engaged_secret';
  if tick_url is null or tick_secret is null then
    return; -- secrets not seeded yet — see migration header
  end if;
  perform net.http_get(
    url := tick_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || tick_secret),
    timeout_milliseconds := 300000
  );
end;
$$;

comment on function public.capi_trial_engaged_tick() is
  'Fires the admin-dash capi-trial-engaged endpoint. Scheduled by pg_cron; reads url+secret from Vault. No-ops until both secrets are seeded.';

revoke all on function public.capi_trial_engaged_tick() from public, anon, authenticated;

-- cron.schedule upserts by jobname, so re-applying this file is safe.
select cron.schedule('capi-trial-engaged', '*/15 * * * *', 'select public.capi_trial_engaged_tick()');
