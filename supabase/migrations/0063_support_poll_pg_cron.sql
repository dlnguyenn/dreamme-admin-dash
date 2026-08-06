-- Poll the Support Inbox from inside Postgres instead of GitHub Actions.
--
-- 2026-08-06: the GitHub `*/20` cron turned out to fire roughly every TWO
-- HOURS under GitHub's best-effort scheduling, and during a GitHub incident
-- ("job was not acquired by Runner") it stopped entirely — taking the
-- 0062 migration run down with it. Support mail then only arrived when Dan
-- happened to open the dashboard. pg_cron runs in our own database, ticks on
-- time, and has no shared-runner queue to lose.
--
-- The job body reads the poll URL and CRON_SECRET from Supabase Vault
-- (names: support_poll_url, support_cron_secret) and no-ops silently until
-- both are seeded, so this migration is safe to apply before the secrets
-- exist. Seeding is a one-time SQL-editor step:
--
--   select vault.create_secret('https://<prod-domain>/api/cron/support-poll', 'support_poll_url');
--   select vault.create_secret('<CRON_SECRET value>', 'support_cron_secret');
--
-- pg_net is fire-and-forget: the request is handed to a background worker
-- and we do not wait on the response. Vercel functions run to completion
-- after the client goes away, and runIngest is idempotent (unique
-- message_id / feedback_id indexes), so overlap with the GitHub and Vercel
-- backstop polls is harmless.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.support_poll_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  poll_url text;
  poll_secret text;
begin
  select decrypted_secret into poll_url
    from vault.decrypted_secrets where name = 'support_poll_url';
  select decrypted_secret into poll_secret
    from vault.decrypted_secrets where name = 'support_cron_secret';
  if poll_url is null or poll_secret is null then
    return; -- secrets not seeded yet — see migration header
  end if;
  perform net.http_get(
    url := poll_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || poll_secret),
    timeout_milliseconds := 300000
  );
end;
$$;

comment on function public.support_poll_tick() is
  'Fires the admin-dash support-poll endpoint. Scheduled by pg_cron; reads url+secret from Vault. No-ops until both secrets are seeded.';

-- The function reads Vault and must not be callable by API roles.
revoke all on function public.support_poll_tick() from public, anon, authenticated;

-- cron.schedule upserts by jobname, so re-applying this file is safe.
select cron.schedule('support-poll', '*/10 * * * *', 'select public.support_poll_tick()');
