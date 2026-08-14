-- 0066: Singular zero-guard — a present-but-zero Singular row must not erase
-- Meta's real trial count.
--
-- WHY: 0065's meta arm used coalesce(s.trial_starts, m.trial_starts), which
-- treats ANY Singular row as authoritative. But Singular's public Reporting
-- API currently serves 0 for every cohort event on this account (their-side
-- defect, ticket 185109) while their UI shows real values — so the sync writes
-- rows whose trial_starts is 0. Those zeros overrode Meta's AEM-reported
-- trials (78 / 51 per campaign), blanking cost_per_trial across the whole
-- dashboard. Observed live 2026-08-14.
--
-- FIX: nullif(s.trial_starts, 0) — Singular wins only when it has a non-zero
-- opinion. If a campaign someday genuinely has zero trials, Meta's own number
-- will be ~0 too, so nothing is lost by falling back.
--
-- The ::bigint casts on the outer sums are load-bearing (see 0065): the live
-- view's columns are bigint and create-or-replace cannot change types.

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
  select campaign_id, date, sum(trial_starts) as trial_starts
  from public.singular_campaign_daily
  where source = 'facebook'
  group by campaign_id, date
),
unioned as (
  select 'meta'::text as channel, m.campaign_id, m.campaign_name, m.date,
         m.spend, m.installs,
         -- Zero-guarded: Singular overrides Meta only with a NON-ZERO count.
         coalesce(nullif(s.trial_starts, 0), m.trial_starts) as trial_starts,
         m.purchases, m.purchase_value,
         case when nullif(s.trial_starts, 0) is not null then 'singular' else 'network' end as trial_source
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
  sum(installs)::bigint       as installs,
  sum(trial_starts)::bigint   as trial_starts,
  sum(purchases)::bigint      as purchases,
  sum(purchase_value) as purchase_value,
  max(trial_source)   as trial_source
from unioned
group by channel, campaign_id, date;

grant select on public.cross_network_cost_daily to anon, authenticated;
