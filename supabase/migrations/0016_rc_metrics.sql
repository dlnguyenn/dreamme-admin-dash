-- RevenueCat sync for "money made" surface on /creatives.
-- Account-level rows always populated; per-ad rows light up once iOS
-- attribution wiring lands (see docs/attribution-handoff.md).

create table if not exists public.rc_account_metrics_daily (
  date date primary key,
  mrr numeric,
  revenue numeric,
  active_trials integer,
  active_subscriptions integer,
  new_customers integer,
  trial_starts integer,
  trial_conversions integer,
  trial_conversion_rate numeric,
  ltv_30d_per_paying_customer numeric,
  synced_at timestamptz not null default now()
);

create index if not exists rc_account_metrics_daily_date_idx
  on public.rc_account_metrics_daily (date desc);

alter table public.rc_account_metrics_daily enable row level security;

drop policy if exists "rc_account_metrics_daily_anon_read" on public.rc_account_metrics_daily;
drop policy if exists "rc_account_metrics_daily_anon_write" on public.rc_account_metrics_daily;

create policy "rc_account_metrics_daily_anon_read" on public.rc_account_metrics_daily
  for select using (true);
create policy "rc_account_metrics_daily_anon_write" on public.rc_account_metrics_daily
  for all using (true) with check (true);


create table if not exists public.rc_ad_metrics_daily (
  ad_id text not null,
  date  date not null,
  trial_starts integer not null default 0,
  trial_conversions integer not null default 0,
  trial_conversion_rate numeric,
  revenue_28d numeric not null default 0,
  ltv_30d numeric,
  active_subscriptions integer not null default 0,
  synced_at timestamptz not null default now(),
  primary key (ad_id, date)
);

create index if not exists rc_ad_metrics_daily_date_idx
  on public.rc_ad_metrics_daily (date desc);

alter table public.rc_ad_metrics_daily enable row level security;

drop policy if exists "rc_ad_metrics_daily_anon_read" on public.rc_ad_metrics_daily;
drop policy if exists "rc_ad_metrics_daily_anon_write" on public.rc_ad_metrics_daily;

create policy "rc_ad_metrics_daily_anon_read" on public.rc_ad_metrics_daily
  for select using (true);
create policy "rc_ad_metrics_daily_anon_write" on public.rc_ad_metrics_daily
  for all using (true) with check (true);
