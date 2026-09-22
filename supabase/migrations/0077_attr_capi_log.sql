-- WHY (2026-09-22): attribution phase 3a — the CAPI forwarder's dedupe +
-- audit log. outlier /api/cron/attr-capi (every 15 min) posts attributed
-- trial starts (attr_start_trial) and first paid starts (attr_subscribe) to
-- the Meta dataset as WEBSITE events carrying the click's fbc / ip / user
-- agent, so a web-objective campaign on the go.dreamme.life/l link can
-- optimize on them. One row per (event_name, event_id); event_id is the
-- RevenueCat original_transaction_id, which is also what Meta dedupes on
-- (event_name + event_id) — a trial and its later conversion share the
-- otid, hence the composite key.
--
-- Own event names on purpose: RevenueCat's Meta integration posts
-- StartTrial/Subscribe with an event_id we cannot see, so dedupe against it
-- is impossible; distinct names mean no collision.
--
-- 'send_failed' rows are retryable — the route re-selects them next tick and
-- merge-duplicates the row on success. Same conventions as 0069
-- (capi_trial_engaged_log): service-role only, RLS enabled, no policies.

create table if not exists public.attr_capi_log (
  event_name text not null check (event_name in ('attr_start_trial','attr_subscribe')),
  event_id text not null,             -- rc_events.original_transaction_id
  install_id uuid not null,           -- attr_installs.install_id the event joined to
  click_id uuid not null,             -- attr_clicks.click_id (the install's matched click)
  app_user_id text,
  status text not null check (status in ('sent','send_failed')),
  meta_response jsonb,                -- CAPI response (events_received / fbtrace_id / error)
  created_at timestamptz not null default now(),
  primary key (event_name, event_id)
);

create index if not exists attr_capi_log_created_idx on public.attr_capi_log (created_at desc);
create index if not exists attr_capi_log_install_idx on public.attr_capi_log (install_id);

comment on table public.attr_capi_log is
  'Dedupe + audit for attributed conversions forwarded to Meta CAPI by outlier /api/cron/attr-capi (attr_start_trial / attr_subscribe as website events with click signals). Keyed by (event_name, original_transaction_id).';

alter table public.attr_capi_log enable row level security;
-- service-role only: no policies on purpose (rc_events / attr_* convention).
