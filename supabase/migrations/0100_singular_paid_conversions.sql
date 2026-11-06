-- 0100: paid conversions from Singular, for trial-to-paid by campaign, ad set and ad.
--
-- RevenueCat's Singular integration (docs/singular-mmp-setup.md, step 6) sends
-- a trial-converted event server-side; Singular ties it to the install that the
-- app's own Singular SDK attributed. The sync counts it per install date over a
-- 14-day cohort (trials convert about 7 days after they start), into
-- paid_conversions. conversion_period records which period was used.
--
-- mmp_ad_attribution and mmp_snapshot gain "mature" columns: installs at least
-- one conversion period old, where both trials and conversions have had time
-- to land. Trial-to-paid is only read from those.

alter table public.singular_campaign_daily
  add column if not exists paid_conversions integer not null default 0,
  add column if not exists conversion_period text;

alter table public.singular_ad_daily
  add column if not exists paid_conversions integer not null default 0,
  add column if not exists conversion_period text;

create or replace view public.mmp_ad_attribution as
with meta as (
  select campaign_id, max(campaign_name) as campaign_name,
         adset_id, max(adset_name) as adset_name,
         ad_id, max(ad_name) as ad_name,
         sum(spend) as spend, sum(installs) as meta_installs, sum(trial_starts) as meta_trials
  from public.ad_insights_daily
  where date >= current_date - 35
  group by campaign_id, adset_id, ad_id
),
sng as (
  select campaign_id, max(campaign_name) as campaign_name,
         adset_id, max(adset_name) as adset_name,
         ad_id, max(ad_name) as ad_name,
         sum(installs) as singular_installs, sum(trial_starts) as singular_trials,
         sum(trial_starts) filter (where date <= current_date - coalesce(nullif(regexp_replace(conversion_period, '\D', '', 'g'), '')::int, 14)) as singular_trials_mature,
         sum(paid_conversions) filter (where date <= current_date - coalesce(nullif(regexp_replace(conversion_period, '\D', '', 'g'), '')::int, 14)) as singular_paid_mature
  from public.singular_ad_daily
  where date >= current_date - 35 and source = 'facebook'
  group by campaign_id, adset_id, ad_id
)
select
  coalesce(m.campaign_id, s.campaign_id) as campaign_id,
  coalesce(m.campaign_name, s.campaign_name) as campaign_name,
  coalesce(m.adset_id, nullif(s.adset_id, '')) as adset_id,
  coalesce(m.adset_name, s.adset_name) as adset_name,
  coalesce(m.ad_id, nullif(s.ad_id, '')) as ad_id,
  coalesce(m.ad_name, s.ad_name) as ad_name,
  coalesce(m.spend, 0) as spend,
  coalesce(m.meta_installs, 0) as meta_installs,
  coalesce(m.meta_trials, 0) as meta_trials,
  coalesce(s.singular_installs, 0) as singular_installs,
  coalesce(s.singular_trials, 0) as singular_trials,
  -- added in 0100
  coalesce(s.singular_trials_mature, 0) as singular_trials_mature,
  coalesce(s.singular_paid_mature, 0) as singular_paid_mature
from meta m
full join sng s
  on s.campaign_id = m.campaign_id and s.adset_id = m.adset_id and s.ad_id = m.ad_id
where coalesce(m.spend, 0) > 0 or coalesce(s.singular_installs, 0) > 0
order by coalesce(m.spend, 0) desc;

revoke all on public.mmp_ad_attribution from anon, authenticated;
grant select on public.mmp_ad_attribution to service_role;

-- One row the MMP tab merges into mmp_snapshot: are paid conversions arriving
-- at all (35 days), and the mature trials and conversions behind the rate.
create or replace view public.mmp_singular_paid as
select
  coalesce(sum(paid_conversions), 0) as sng_paid_35d,
  coalesce(sum(trial_starts) filter (where date <= current_date - coalesce(nullif(regexp_replace(conversion_period, '\D', '', 'g'), '')::int, 14)), 0) as sng_trials_mature,
  coalesce(sum(paid_conversions) filter (where date <= current_date - coalesce(nullif(regexp_replace(conversion_period, '\D', '', 'g'), '')::int, 14)), 0) as sng_paid_mature
from public.singular_campaign_daily
where date >= current_date - 35 and source = 'facebook';

revoke all on public.mmp_singular_paid from anon, authenticated;
grant select on public.mmp_singular_paid to service_role;
