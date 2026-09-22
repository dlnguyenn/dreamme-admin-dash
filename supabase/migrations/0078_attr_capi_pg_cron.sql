-- WHY (2026-09-22): the outlier CAPI forwarder (/api/cron/attr-capi, PR
-- dlnguyenn/outlier#1) needs a 15-minute cadence so attributed trials reach
-- Meta while the click is fresh, but the dream-me-internal Vercel team is on
-- Hobby, where sub-daily crons fail deployment. Same fallback as 0069
-- (capi-trial-engaged): a pg_cron tick that reads url + secret from Vault and
-- no-ops until both are seeded. outlier keeps a daily Vercel backstop.
--
-- One-time seeding (done via MCP on 2026-09-22):
--   select vault.create_secret('https://outlier-snowy.vercel.app/api/cron/attr-capi', 'attr_capi_url');
--   select vault.create_secret('<outlier CRON_SECRET>', 'attr_capi_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.attr_capi_tick()
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
    from vault.decrypted_secrets where name = 'attr_capi_url';
  select decrypted_secret into tick_secret
    from vault.decrypted_secrets where name = 'attr_capi_secret';
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

comment on function public.attr_capi_tick() is
  'Fires outlier /api/cron/attr-capi (Meta CAPI forwarder for attributed trials/subscribes). Scheduled by pg_cron every 15 min; reads url+secret from Vault. No-ops until both secrets are seeded.';

revoke all on function public.attr_capi_tick() from public, anon, authenticated;

-- cron.schedule upserts by jobname, so re-applying this file is safe.
select cron.schedule('attr-capi', '*/15 * * * *', 'select public.attr_capi_tick()');
