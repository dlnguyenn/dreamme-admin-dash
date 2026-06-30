-- Module 1 — Cross-Network Cost + Blended CAC engine.
--
-- One network-agnostic per-campaign cost/CAC/ROAS surface unifying Meta
-- (ad_insights_daily) + TikTok (tiktok_ad_insights_daily) + a hand-entered
-- "other" channel (manual_channel_spend, e.g. Apple Search Ads / influencer),
-- plus a single blended row that uses RevenueCat as the truth denominator.
--
-- Honesty note baked into the design: per-campaign trial/purchase/revenue
-- counts are NETWORK-REPORTED and unreliable on iOS — Meta sees only a fraction
-- of real trials (validated: 180 network trials vs 3,974 RC trials over 35d). So
-- per-campaign numbers are for RELATIVE ranking; the blended row (total spend ÷
-- RevenueCat trials) is the absolute truth, mirroring skan_reconciliation.
-- Apple Search Ads has no vendor yet — it slots in later as another UNION arm
-- (or via manual_channel_spend) with no shape change.

-- Hand-entered spend for channels without an API sync (ASA, influencer, etc.).
-- Anon read+write (matches skan_cv_schema) so it can be entered from the
-- dashboard or a CLI without a service-role round-trip.
create table if not exists public.manual_channel_spend (
  id uuid primary key default gen_random_uuid(),
  channel text not null,                 -- e.g. 'apple_search', 'influencer', 'other'
  campaign_id text not null,
  campaign_name text,
  date date not null,
  spend numeric not null default 0,
  installs integer not null default 0,
  trial_starts integer not null default 0,
  purchases integer not null default 0,
  purchase_value numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists manual_channel_spend_date_idx
  on public.manual_channel_spend (date desc);
create index if not exists manual_channel_spend_campaign_idx
  on public.manual_channel_spend (channel, campaign_id);

alter table public.manual_channel_spend enable row level security;
drop policy if exists "manual_channel_spend_anon_read" on public.manual_channel_spend;
drop policy if exists "manual_channel_spend_anon_write" on public.manual_channel_spend;
create policy "manual_channel_spend_anon_read" on public.manual_channel_spend for select using (true);
create policy "manual_channel_spend_anon_write" on public.manual_channel_spend for all using (true) with check (true);

-- Normalized per-(channel, campaign, day) spend + network-reported events.
-- Aggregates each channel's per-ad rows up to campaign grain so downstream
-- rollups are clean. `channel` namespaces campaign ids across networks.
create or replace view public.cross_network_cost_daily as
with unioned as (
  select 'meta'::text  as channel, campaign_id, campaign_name, date,
         spend, installs, trial_starts, purchases, purchase_value
  from public.ad_insights_daily
  union all
  select 'tiktok'::text, campaign_id, campaign_name, date,
         spend, installs, trial_starts, purchases, purchase_value
  from public.tiktok_ad_insights_daily
  union all
  select channel, campaign_id, campaign_name, date,
         spend, installs, trial_starts, purchases, purchase_value
  from public.manual_channel_spend
  -- Apple Search Ads slots in here as a 4th UNION arm when a vendor exists.
)
select
  channel,
  campaign_id,
  max(campaign_name)      as campaign_name,
  date,
  sum(spend)              as spend,
  sum(installs)           as installs,
  sum(trial_starts)       as trial_starts,
  sum(purchases)          as purchases,
  sum(purchase_value)     as purchase_value
from unioned
group by channel, campaign_id, date;

-- 35-day per-campaign rollup with cost-per + ROAS (network-reported — relative
-- ranking only; see header note).
create or replace view public.cross_network_campaign_efficiency as
select
  channel,
  campaign_id,
  max(campaign_name)                                                    as campaign_name,
  sum(spend)                                                           as spend,
  sum(installs)                                                        as installs,
  sum(trial_starts)                                                    as network_trials,
  sum(purchases)                                                       as network_purchases,
  sum(purchase_value)                                                  as network_revenue,
  case when sum(trial_starts) > 0 then sum(spend) / sum(trial_starts) end as cost_per_trial,
  case when sum(purchases)    > 0 then sum(spend) / sum(purchases)    end as cac,
  case when sum(spend)        > 0 then sum(purchase_value) / sum(spend) end as roas
from public.cross_network_cost_daily
where date >= current_date - 35
group by channel, campaign_id
order by sum(spend) desc nulls last;

-- Single-row blended truth: total cross-network spend ÷ RevenueCat economics
-- (the causal-sanity numbers we trust). network_trials_35d vs rc_trials_35d
-- exposes how badly the networks under-report iOS trials.
create or replace view public.cross_network_blended as
with spend35 as (
  select coalesce(sum(spend), 0) as spend, coalesce(sum(trial_starts), 0) as net_trials
  from public.cross_network_cost_daily where date >= current_date - 35
),
rc35 as (
  select coalesce(sum(trial_starts), 0) as trials,
         coalesce(sum(trial_conversions), 0) as subs,
         coalesce(sum(revenue), 0) as revenue
  from public.rc_account_metrics_daily where date >= current_date - 35
)
select
  s.spend                                          as total_spend_35d,
  s.net_trials                                     as network_trials_35d,
  r.trials                                         as rc_trials_35d,
  r.subs                                           as rc_subscribes_35d,
  r.revenue                                        as rc_revenue_35d,
  s.spend / nullif(r.trials, 0)                    as blended_cac_per_trial_35d,
  s.spend / nullif(r.subs, 0)                      as blended_cac_per_sub_35d,
  r.revenue / nullif(s.spend, 0)                   as blended_roas_35d,
  s.net_trials::numeric / nullif(r.trials, 0)      as network_trial_coverage  -- network ÷ RC (how much networks see)
from spend35 s cross join rc35 r;

grant select on public.cross_network_cost_daily          to anon, authenticated;
grant select on public.cross_network_campaign_efficiency to anon, authenticated;
grant select on public.cross_network_blended             to anon, authenticated;
