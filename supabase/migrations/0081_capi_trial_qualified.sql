-- trial_qualified → Meta CAPI, sent by the dash (replaces n8n).
--
-- Why: the n8n "Meta Ads Qualified Trial Event Fire" workflow died on
-- 2026-07-06 (no trial_qualified in Events Manager as of 2026-09-30). The
-- dash route /api/cron/capi-trial-qualified re-implements the rule
-- (RevenueCat still shows the trial renewing 2h after start) and sends a
-- website event, which a web-objective campaign can optimize on.
--
-- Audit/dedupe table: one row per trial (original_transaction_id). Terminal
-- rows: sent, not_renewing, no_rc_subscription. send_failed is retried by the
-- next tick. Scheduled by GitHub Actions (.github/workflows/
-- capi-trial-qualified.yml), not pg_cron, so a failing run alerts.
create table if not exists public.capi_trial_qualified_log (
  original_transaction_id text primary key,
  app_user_id text not null,
  store text,
  trial_started_at timestamptz not null,
  status text not null check (status in ('sent','not_renewing','no_rc_subscription','send_failed')),
  has_ua boolean,                  -- sent with client_user_agent (from attr_installs)
  meta_response jsonb,             -- CAPI response body for sent / send_failed
  created_at timestamptz not null default now()
);

create index if not exists capi_trial_qualified_log_started_idx
  on public.capi_trial_qualified_log (trial_started_at desc);

comment on table public.capi_trial_qualified_log is
  'Dedupe + audit for server-side trial_qualified CAPI events (qualified = RevenueCat subscription still trialing/active and renewing 2h after trial start). Replaces n8n workflow wEZAcV8qNd0OTUBQ.';

alter table public.capi_trial_qualified_log enable row level security;
-- service-role only, like capi_trial_engaged_log.
