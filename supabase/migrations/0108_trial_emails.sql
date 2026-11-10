-- 0108: trial emails — day-0 and day-1 emails to new trialists, 50% held out.
--
-- WHAT: every new App Store / Play trial (production, real user id, no earlier
-- purchase) gets an arm on a hash of its app_user_id: half `email`, half
-- `holdout`. Email-arm trialists get a day-0 email a few minutes after trial
-- start and a day-1 email ~24h in. Holdout trialists get nothing new. The read
-- is paid-within-14-days per arm from rc_events (trial_email_arm_stats below).
-- Design and copy: vault wiki/trial-email-test.md.
--
-- OFF SWITCH: trial_email_config.enabled starts FALSE. While false the route
-- returns before reading anything else, so this migration is inert. Turning it
-- on is a one-line SQL update (see the bottom of this file) and needs Dan's yes.
-- The DAD has no button for it on purpose: the dashboard's same-origin gate is
-- browser-only, and an email switch should not be one fetch away.
--
-- CRON: pg_cron every 5 minutes, reusing the support-poll Vault secrets (the
-- URL is support_poll_url with the path swapped, the secret is the same
-- CRON_SECRET), so no new seeding step. No-ops until those exist.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------- switch --
create table if not exists public.trial_email_config (
  id          boolean primary key default true check (id),
  enabled     boolean     not null default false,
  -- Trials that started before this moment are never assigned, so turning the
  -- switch on does not backfill. Set together with enabled = true.
  started_at  timestamptz,
  stopped_at  timestamptz,
  experiment  text        not null default 'trial-email-v1',
  updated_at  timestamptz not null default now()
);
insert into public.trial_email_config (id) values (true) on conflict (id) do nothing;
alter table public.trial_email_config enable row level security;

-- ----------------------------------------------------------- assignments --
create table if not exists public.trial_email_assignments (
  original_transaction_id text        primary key,
  experiment              text        not null default 'trial-email-v1',
  app_user_id             text        not null,
  arm                     text        not null check (arm in ('email', 'holdout')),
  bucket                  integer     not null check (bucket between 0 and 99),
  platform                text        not null check (platform in ('ios', 'android')),
  product_id              text,
  trial_start_at          timestamptz not null,
  assigned_at             timestamptz not null default now(),
  -- Recorded at assignment for both arms, so arms can be compared on them.
  email_on_file           boolean,
  journey_stage           text,

  -- Per send: claimed (row locked for this send), then sent or skipped.
  -- A claimed row with neither sent_at nor skip_reason = crashed mid-send:
  -- visible, never retried (at most one email per trial per kind).
  day0_claimed_at         timestamptz,
  day0_sent_at            timestamptz,
  day0_skip_reason        text,
  day0_variant            text,
  day0_message_id         text,
  day1_claimed_at         timestamptz,
  day1_sent_at            timestamptz,
  day1_skip_reason        text,
  day1_variant            text,
  day1_message_id         text,

  day0_first_click_at     timestamptz,
  day1_first_click_at     timestamptz,
  clicks                  integer     not null default 0,
  unsubscribed_at         timestamptz
);

-- One person is in the experiment once, whatever happens to their trials.
create unique index if not exists trial_email_assignments_user_uidx
  on public.trial_email_assignments (experiment, app_user_id);
create index if not exists trial_email_assignments_start_idx
  on public.trial_email_assignments (trial_start_at desc);

alter table public.trial_email_assignments enable row level security;

-- ---------------------------------------------------------- suppressions --
-- Shared do-not-email list for every user-facing email we send (Black Friday
-- should read it too). Lowercased address.
create table if not exists public.email_suppressions (
  email       text        primary key check (email = lower(email)),
  reason      text        not null default 'unsubscribe',
  source      text        not null default 'trial-email-v1',
  app_user_id text,
  created_at  timestamptz not null default now()
);
alter table public.email_suppressions enable row level security;

-- --------------------------------------------------------------- results --
-- Per arm and platform. "Paid" = the first paid event on the same original
-- transaction within 14 days of trial start (same definition as the
-- 2026-11-09 value-per-trial table). Maturity columns count only trials old
-- enough for each window, so young trials never dilute a rate.
create or replace function public.trial_email_arm_stats(p_experiment text default 'trial-email-v1')
returns table (
  arm             text,
  platform        text,
  assigned        bigint,
  email_on_file   bigint,
  matured_48h     bigint,
  cancelled_48h   bigint,
  matured_7d      bigint,
  cancelled_7d    bigint,
  matured_14d     bigint,
  paid_14d        bigint,
  refunded_14d    bigint
)
language sql
stable
set search_path = public
as $$
  with a as (
    select * from public.trial_email_assignments where experiment = p_experiment
  ),
  c as (
    select a.original_transaction_id, min(e.event_at) as cancel_at
    from a join public.rc_events e
      on e.original_transaction_id = a.original_transaction_id
     and e.type = 'CANCELLATION' and e.period_type = 'TRIAL'
     and e.event_at >= a.trial_start_at
    group by 1
  ),
  p as (
    select a.original_transaction_id, min(e.event_at) as paid_at
    from a join public.rc_events e
      on e.original_transaction_id = a.original_transaction_id
     and e.period_type = 'NORMAL' and coalesce(e.price_usd, 0) > 0
     and e.type in ('RENEWAL', 'PRODUCT_CHANGE', 'INITIAL_PURCHASE')
     and e.event_at > a.trial_start_at
     and e.event_at < a.trial_start_at + interval '14 days'
    group by 1
  ),
  r as (
    select a.original_transaction_id, min(e.event_at) as refund_at
    from a join public.rc_events e
      on e.original_transaction_id = a.original_transaction_id
     and e.type = 'CANCELLATION' and e.cancel_reason = 'CUSTOMER_SUPPORT'
    group by 1
  )
  select
    a.arm,
    a.platform,
    count(*),
    count(*) filter (where a.email_on_file),
    count(*) filter (where a.trial_start_at < now() - interval '48 hours'),
    count(*) filter (where a.trial_start_at < now() - interval '48 hours'
                       and c.cancel_at < a.trial_start_at + interval '48 hours'),
    count(*) filter (where a.trial_start_at < now() - interval '7 days'),
    count(*) filter (where a.trial_start_at < now() - interval '7 days'
                       and c.cancel_at < a.trial_start_at + interval '7 days'),
    count(*) filter (where a.trial_start_at < now() - interval '14 days'),
    count(*) filter (where a.trial_start_at < now() - interval '14 days' and p.paid_at is not null),
    count(*) filter (where a.trial_start_at < now() - interval '14 days' and p.paid_at is not null
                       and r.refund_at is not null)
  from a
  left join c using (original_transaction_id)
  left join p using (original_transaction_id)
  left join r using (original_transaction_id)
  group by a.arm, a.platform
$$;

revoke all on function public.trial_email_arm_stats(text) from public, anon, authenticated;

-- ------------------------------------------------------------------ cron --
create or replace function public.trial_emails_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  poll_url text;
  poll_secret text;
begin
  -- Cheap exit while the switch is off: no HTTP call at all.
  if not coalesce((select enabled from public.trial_email_config where id), false) then
    return;
  end if;
  select replace(decrypted_secret, '/api/cron/support-poll', '/api/cron/trial-emails') into poll_url
    from vault.decrypted_secrets where name = 'support_poll_url';
  select decrypted_secret into poll_secret
    from vault.decrypted_secrets where name = 'support_cron_secret';
  if poll_url is null or poll_secret is null or poll_url not like '%/api/cron/trial-emails%' then
    return; -- support-poll secrets not seeded (see 0063)
  end if;
  perform net.http_get(
    url := poll_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || poll_secret),
    timeout_milliseconds := 300000
  );
end;
$$;

comment on function public.trial_emails_tick() is
  'Fires /api/cron/trial-emails every 5 min while trial_email_config.enabled. Reuses the support-poll Vault secrets.';

revoke all on function public.trial_emails_tick() from public, anon, authenticated;

-- cron.schedule upserts by jobname, so re-applying this file is safe.
select cron.schedule('trial-emails', '*/5 * * * *', 'select public.trial_emails_tick()');

-- To start the test (Dan's yes required):
--   update public.trial_email_config
--      set enabled = true, started_at = now(), stopped_at = null, updated_at = now()
--    where id;
-- To stop it:
--   update public.trial_email_config
--      set enabled = false, stopped_at = now(), updated_at = now()
--    where id;
