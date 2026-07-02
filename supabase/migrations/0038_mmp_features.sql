-- 0038: MMP feature parity — anomaly alerts (Singular), payer retention
-- cohorts (AppsFlyer cohort reports), SKAN health (Protect360-lite), and an
-- LTV:CAC payback summary (AppsFlyer ROI).

-- 1) Anomaly alerts -----------------------------------------------------------
-- Written daily by /api/cron/marketing-alerts (service role); anon read-only.
create table if not exists public.marketing_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_date date not null,
  scope text not null check (scope in ('account', 'campaign')),
  campaign_id text,
  campaign_name text,
  metric text not null,
  value numeric,
  baseline numeric,
  z numeric,
  direction text check (direction in ('spike', 'drop')),
  severity text not null default 'warn' check (severity in ('info', 'warn', 'critical')),
  message text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- One alert per (day, scope, campaign, metric) — the cron upserts against this.
-- NULLS NOT DISTINCT so account-scope rows (campaign_id null) dedupe too, and
-- so PostgREST on_conflict can target the plain column list.
create unique index if not exists marketing_alerts_dedupe
  on public.marketing_alerts (alert_date, scope, campaign_id, metric)
  nulls not distinct;

alter table public.marketing_alerts enable row level security;
drop policy if exists marketing_alerts_anon_read on public.marketing_alerts;
create policy marketing_alerts_anon_read on public.marketing_alerts
  for select to anon, authenticated using (true);
-- (writes go through the service role, which bypasses RLS)

-- 2) Payer retention cohorts --------------------------------------------------
-- Weekly cohorts by first_active_at from rc_customer_snapshot (populated by the
-- audience-sync cron). status: 'active' | 'lapsed'. Empty until the first sync.
create or replace view public.payer_retention_cohorts as
select
  date_trunc('week', first_active_at)::date as cohort_week,
  count(*) as payers,
  count(*) filter (where status = 'active') as active_now,
  count(*) filter (where status = 'lapsed') as lapsed,
  round(
    count(*) filter (where status = 'active')::numeric / nullif(count(*), 0),
    4
  ) as retention_rate,
  round(avg(extract(epoch from (coalesce(became_lapsed_at, now()) - first_active_at)) / 86400.0)::numeric, 1)
    as avg_tenure_days
from public.rc_customer_snapshot
where first_active_at is not null
group by 1
order by 1 desc;

-- 3) SKAN health (Protect360-lite) -------------------------------------------
-- Signature validity, redownload share, and click/view fidelity mix straight
-- off the raw postbacks. Owner-rights view so anon can read the aggregate while
-- the base table stays service-role-only (same pattern as skan_reconciliation).
create or replace view public.skan_health as
select
  count(*) as postbacks_total,
  count(*) filter (where signature_status = 'valid') as sig_valid,
  count(*) filter (where signature_status <> 'valid') as sig_invalid_or_unverified,
  count(*) filter (where coalesce(did_win, true) = false) as did_not_win,
  count(*) filter (where coalesce(redownload, false)) as redownloads,
  round(count(*) filter (where coalesce(redownload, false))::numeric / nullif(count(*), 0), 4)
    as redownload_rate,
  count(*) filter (where fidelity_type = 1) as click_through,
  count(*) filter (where fidelity_type = 0) as view_through,
  min(received_at) as first_postback_at,
  max(received_at) as last_postback_at
from public.skan_postbacks;

-- 4) Payback summary (LTV:CAC) ------------------------------------------------
-- Blended CAC per sub (35d) vs 30d LTV per paying customer → LTV:CAC ratio.
-- Note this uses 30d LTV, so the ratio is conservative vs lifetime LTV.
create or replace view public.payback_summary as
with b as (
  select blended_cac_per_trial_35d, blended_cac_per_sub_35d
  from public.cross_network_blended
),
l as (
  select avg(ltv_30d_per_paying_customer)
           filter (where ltv_30d_per_paying_customer is not null) as ltv30
  from public.rc_account_metrics_daily
  where date >= (current_date - 30)
)
select
  b.blended_cac_per_trial_35d,
  b.blended_cac_per_sub_35d,
  l.ltv30 as ltv_30d_per_payer,
  round(l.ltv30 / nullif(b.blended_cac_per_sub_35d, 0), 2) as ltv30_to_cac,
  case
    when l.ltv30 is null or b.blended_cac_per_sub_35d is null then null
    when l.ltv30 >= b.blended_cac_per_sub_35d then 'payback < 30d'
    else 'payback > 30d'
  end as payback_verdict
from b cross join l;
