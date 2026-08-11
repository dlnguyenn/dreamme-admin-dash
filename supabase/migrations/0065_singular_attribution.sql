-- 0065: Singular (MMP) campaign reporting.
--
-- WHY: we cannot currently answer "how many free trials did each Meta campaign
-- drive?". rc_ad_metrics_daily is written with zero rows (see
-- sync-revenuecat/route.ts — it lights up only once iOS attribution ships), and
-- the first-party SKAN collector decodes ~6% of postbacks because Apple's crowd
-- anonymity nulls the rest. Singular becomes the primary MMP; the DIY collector
-- stays as an independent cross-check.
--
-- Grain is (source, campaign_id, date). Sub-campaign/adset grain is deliberately
-- out of scope: it would break the PK and cross_network_cost_daily aggregates to
-- campaign anyway.
--
-- Cohort semantics matter for anyone reading this table: trial_starts is a
-- COHORT metric anchored to the INSTALL date, not the event date. The row for
-- 2026-08-01 holds trials started by users who INSTALLED on 2026-08-01, counted
-- within cohort_period. Singular recomputes cohorts on every report run, so the
-- sync re-upserts the whole window rather than appending — see
-- src/app/api/cron/sync-singular/route.ts.

create table if not exists public.singular_campaign_daily (
  source            text        not null,               -- 'facebook', 'apple_search_ads', ...
  campaign_id       text        not null,               -- Singular unified_campaign_id
  date              date        not null,               -- INSTALL date (cohort anchor)
  campaign_name     text,
  os                text,
  spend             numeric     not null default 0,     -- adn_cost
  installs          integer     not null default 0,     -- custom_installs (network number for SANs)
  adn_installs      integer     not null default 0,     -- what the network itself claims
  tracker_installs  integer     not null default 0,     -- what Singular attributed device-level
  trial_starts      integer     not null default 0,     -- cohort event
  subscribes        integer     not null default 0,     -- cohort event
  revenue           numeric     not null default 0,     -- cohort revenue (ltv period)
  cohort_period     text,                               -- '7d' | '14d' | 'ltv' — which window the cohort cols are from
  synced_at         timestamptz not null default now(),
  primary key (source, campaign_id, date)
);

create index if not exists singular_campaign_daily_date_idx
  on public.singular_campaign_daily (date desc);
create index if not exists singular_campaign_daily_campaign_idx
  on public.singular_campaign_daily (campaign_id);

alter table public.singular_campaign_daily enable row level security;

drop policy if exists "singular_campaign_daily_anon_read" on public.singular_campaign_daily;
drop policy if exists "singular_campaign_daily_anon_write" on public.singular_campaign_daily;

create policy "singular_campaign_daily_anon_read" on public.singular_campaign_daily
  for select using (true);
create policy "singular_campaign_daily_anon_write" on public.singular_campaign_daily
  for all using (true) with check (true);


-- ---------------------------------------------------------------------------
-- cross_network_cost_daily — enrich the meta arm, do NOT add a 4th meta arm
-- ---------------------------------------------------------------------------
-- 0032:61 has a TODO inviting a 4th UNION arm. Adding Singular's FACEBOOK rows
-- there would DOUBLE-COUNT: ad_insights_daily already contributes those same
-- campaigns as channel 'meta'. cross_network_blended.total_spend_35d would
-- roughly double and blended_cac_per_trial_35d roughly halve — silently
-- corrupting the north-star CAC with no error anywhere.
--
-- Instead: Meta stays authoritative for its own spend (it is), and Singular
-- supplies the trial count it is better at, via coalesce. The literal 4th arm
-- is reserved for sources Singular reports that have NO vendor client of their
-- own (Apple Search Ads etc.) — zero overlap, so no double count.
--
-- CRITICAL: the join happens AFTER aggregating meta to campaign grain.
-- ad_insights_daily is per-AD; joining campaign-level Singular rows onto per-ad
-- rows would fan the trial count out across every ad in the campaign and then
-- sum it. Verified against prod: the meta_campaign CTE below reproduces the
-- current view's meta arm exactly (381 rows, zero rows differing either way).
--
-- create-or-replace cannot rename/reorder/retype existing columns but CAN
-- append, so trial_source is added as a 10th column. Downstream views
-- (cross_network_campaign_efficiency, cross_network_blended) use explicit
-- column lists and need no change.
create or replace view public.cross_network_cost_daily as
with meta_campaign as (
  select campaign_id,
         max(campaign_name)  as campaign_name,
         date,
         sum(spend)          as spend,
         sum(installs)       as installs,
         sum(trial_starts)   as trial_starts,
         sum(purchases)      as purchases,
         sum(purchase_value) as purchase_value
  from public.ad_insights_daily
  group by campaign_id, date
),
singular_meta as (
  -- Only Meta rows here; other sources become their own channel below.
  select campaign_id, date, sum(trial_starts) as trial_starts
  from public.singular_campaign_daily
  where source = 'facebook'
  group by campaign_id, date
),
unioned as (
  select 'meta'::text as channel, m.campaign_id, m.campaign_name, m.date,
         m.spend, m.installs,
         -- Singular wins where it has an opinion; Meta's own number is the
         -- fallback so this view never regresses if the sync is down.
         coalesce(s.trial_starts, m.trial_starts) as trial_starts,
         m.purchases, m.purchase_value,
         case when s.trial_starts is not null then 'singular' else 'network' end as trial_source
  from meta_campaign m
  left join singular_meta s
    on s.campaign_id = m.campaign_id and s.date = m.date
  union all
  select 'tiktok'::text, campaign_id, campaign_name, date,
         spend, installs, trial_starts, purchases, purchase_value, 'network'::text
  from public.tiktok_ad_insights_daily
  union all
  select channel, campaign_id, campaign_name, date,
         spend, installs, trial_starts, purchases, purchase_value, 'network'::text
  from public.manual_channel_spend
  union all
  -- The 4th arm the 0032 TODO actually anticipated: networks Singular reports
  -- that nothing else in this view covers. Namespaced so a future vendor client
  -- for one of them cannot silently start double-counting against this arm.
  select 'singular:' || source, campaign_id, campaign_name, date,
         spend, installs, trial_starts,
         null::integer, null::numeric, 'singular'::text
  from public.singular_campaign_daily
  where source <> 'facebook'
)
select
  channel,
  campaign_id,
  max(campaign_name)  as campaign_name,
  date,
  sum(spend)          as spend,
  sum(installs)       as installs,
  sum(trial_starts)   as trial_starts,
  sum(purchases)      as purchases,
  sum(purchase_value) as purchase_value,
  max(trial_source)   as trial_source
from unioned
group by channel, campaign_id, date;


-- ---------------------------------------------------------------------------
-- singular_reconciliation — Singular's trials vs RevenueCat truth
-- ---------------------------------------------------------------------------
-- Owner-rights (NOT security_invoker), per the 0031 convention, so the UI can
-- read the aggregate with the anon key.
--
-- Reads public.rc_events DIRECTLY rather than going through the existing
-- rc_trial_starts_daily view. That view is declared `security_invoker = on`
-- (0060:14) over rc_events, whose RLS is service-role only — so an anon
-- client selecting through it gets ZERO ROWS AND NO ERROR. Its only current
-- consumer (src/lib/overview.ts) reads it server-side with the service role.
-- Selecting from it here would produce a reconciliation tile that silently
-- reported 0 RC trials and therefore infinite coverage.
--
-- The America/New_York bucketing and the event predicate below are duplicated
-- from 0060 deliberately; if that definition changes, change it here too.
create or replace view public.singular_reconciliation as
with sng35 as (
  select coalesce(sum(trial_starts), 0)              as trials,
         coalesce(sum(spend), 0)                     as spend,
         count(distinct campaign_id)                 as campaigns
  from public.singular_campaign_daily
  where source = 'facebook'
    and date >= current_date - 35
),
rc35 as (
  select count(*)::int as trials
  from public.rc_events
  where type = 'INITIAL_PURCHASE'
    and period_type = 'TRIAL'
    and coalesce(environment, '') <> 'SANDBOX'
    and (event_at at time zone 'America/New_York')::date >= current_date - 35
)
select
  s.trials                                        as singular_trials_35d,
  r.trials                                        as rc_trials_35d,
  s.spend                                         as singular_spend_35d,
  s.campaigns                                     as attributed_campaigns,
  -- Never 100%: Meta drives only a share of installs, and organic / ASA /
  -- TikTok sit in the RC denominator but never in a source=facebook report.
  s.trials::numeric / nullif(r.trials, 0)         as singular_trial_coverage,
  s.spend / nullif(s.trials, 0)                   as singular_cost_per_trial_35d
from sng35 s cross join rc35 r;

grant select on public.singular_campaign_daily  to anon, authenticated;
grant select on public.cross_network_cost_daily to anon, authenticated;
grant select on public.singular_reconciliation  to anon, authenticated;
