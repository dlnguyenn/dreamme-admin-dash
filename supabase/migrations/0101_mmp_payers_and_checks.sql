-- 0101: what the MMP tab needs to rank ads by cost per payer, plus three checks.
--
-- 1. user_sources gains birth_year and gender (copied nightly from the consumer
--    users table by the existing sync). Birth year only, not the date. The
--    onboarding default 1995-01-01 is stored as null (unknown).
-- 2. trial_to_paid_by_age: real trial-to-paid by age band, from RevenueCat
--    trials 10-120 days old (old enough to have converted) joined to birth year.
-- 3. asc_downloads_daily: Apple's App Downloads Detailed report (all
--    downloads, not just opted-in devices) by download type, source type and
--    referring app. Filled by scripts/asc-downloads.mjs. mmp_asc_sources rolls
--    first-time downloads into buckets beside Meta's claimed iOS installs.
-- 4. mmp_adset_week: the last 7 full days per ad set, for the benchmark and
--    optimization-volume checks.
-- 5. Trial-to-paid window fix: conversions only reach Singular from the day
--    RevenueCat's integration went live, so installs whose trials converted
--    before that can't count. The mature window now starts at the first
--    install date with any conversion.

alter table public.user_sources
  add column if not exists birth_year integer,
  add column if not exists gender text;

create or replace view public.trial_to_paid_by_age as
with t as (
  select e.original_transaction_id, e.app_user_id, e.store, e.event_at
  from public.rc_events e
  where e.type = 'INITIAL_PURCHASE' and e.period_type = 'TRIAL' and e.environment = 'PRODUCTION'
    and e.event_at >= now() - interval '120 days' and e.event_at < now() - interval '10 days'
),
c as (
  select distinct original_transaction_id
  from public.rc_events
  where type = 'RENEWAL' and environment = 'PRODUCTION' and raw->'event'->>'is_trial_conversion' = 'true'
),
j as (
  select t.store,
         (c.original_transaction_id is not null) as converted,
         case
           when us.birth_year is null then 'unknown'
           when extract(year from t.event_at)::int - us.birth_year < 18 then 'under 18'
           when extract(year from t.event_at)::int - us.birth_year < 25 then '18-24'
           when extract(year from t.event_at)::int - us.birth_year < 35 then '25-34'
           when extract(year from t.event_at)::int - us.birth_year < 45 then '35-44'
           when extract(year from t.event_at)::int - us.birth_year < 55 then '45-54'
           when extract(year from t.event_at)::int - us.birth_year < 65 then '55-64'
           else '65+'
         end as age_band
  from t
  left join c using (original_transaction_id)
  left join public.user_sources us on us.user_id = t.app_user_id
)
select
  age_band,
  count(*) as trials,
  count(*) filter (where converted) as converted,
  count(*) filter (where store = 'APP_STORE') as trials_ios,
  count(*) filter (where store = 'APP_STORE' and converted) as converted_ios
from j
group by age_band;

revoke all on public.trial_to_paid_by_age from anon, authenticated;
grant select on public.trial_to_paid_by_age to service_role;

create table if not exists public.asc_downloads_daily (
  date          date not null,
  download_type text not null,
  source_type   text not null,
  source_app    text not null default '',
  counts        integer not null default 0,
  synced_at     timestamptz not null default now(),
  primary key (date, download_type, source_type, source_app)
);
alter table public.asc_downloads_daily enable row level security;
revoke all on public.asc_downloads_daily from anon, authenticated;
grant all on public.asc_downloads_daily to service_role;

create or replace view public.mmp_asc_sources as
with w as (
  select max(date) as last_date from public.asc_downloads_daily
),
d as (
  select
    case
      when source_type = 'App referrer' and source_app ilike '%facebook%' then 'Facebook app'
      when source_type = 'App referrer' and source_app ilike '%instagram%' then 'Instagram app'
      when source_type = 'App referrer' then 'Other apps'
      when source_type = 'App Store search' then 'App Store search'
      when source_type = 'App Store browse' then 'App Store browse'
      when source_type = 'Web referrer' then 'Web'
      else source_type
    end as bucket,
    sum(counts) as downloads
  from public.asc_downloads_daily, w
  where download_type = 'First-time download' and date > w.last_date - 35
  group by 1
),
meta as (
  select coalesce(sum(a.installs), 0) as meta_ios_installs
  from public.ad_insights_daily a, w
  where a.date > w.last_date - 35 and a.date <= w.last_date and a.campaign_name ilike '%(iOS)%'
)
select d.bucket, d.downloads, w.last_date, meta.meta_ios_installs
from d, w, meta;

revoke all on public.mmp_asc_sources from anon, authenticated;
grant select on public.mmp_asc_sources to service_role;

create or replace view public.mmp_adset_week as
select
  adset_id,
  max(adset_name) as adset_name,
  max(campaign_id) as campaign_id,
  max(campaign_name) as campaign_name,
  sum(spend) as spend,
  sum(clicks) as clicks,
  sum(installs) as installs,
  sum(trial_starts) as trials
from public.ad_insights_daily
where date >= current_date - 7 and date < current_date
group by adset_id
having sum(spend) > 0;

revoke all on public.mmp_adset_week from anon, authenticated;
grant select on public.mmp_adset_week to service_role;

-- marketing_alerts gains an 'adset' scope for the weekly benchmark checks
-- (campaign_id then holds the ad set id).
alter table public.marketing_alerts drop constraint if exists marketing_alerts_scope_check;
alter table public.marketing_alerts add constraint marketing_alerts_scope_check
  check (scope = any (array['account'::text, 'campaign'::text, 'adset'::text]));

-- 5. Trial-to-paid window fix (same columns as 0100).
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
start as (
  select min(date) as first_date from public.singular_ad_daily where paid_conversions > 0
),
sng as (
  select campaign_id, max(campaign_name) as campaign_name,
         adset_id, max(adset_name) as adset_name,
         ad_id, max(ad_name) as ad_name,
         sum(installs) as singular_installs, sum(trial_starts) as singular_trials,
         sum(trial_starts) filter (where date >= start.first_date and date <= current_date - coalesce(nullif(regexp_replace(conversion_period, '\D', '', 'g'), '')::int, 14)) as singular_trials_mature,
         sum(paid_conversions) filter (where date >= start.first_date and date <= current_date - coalesce(nullif(regexp_replace(conversion_period, '\D', '', 'g'), '')::int, 14)) as singular_paid_mature
  from public.singular_ad_daily, start
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
  coalesce(s.singular_trials_mature, 0) as singular_trials_mature,
  coalesce(s.singular_paid_mature, 0) as singular_paid_mature
from meta m
full join sng s
  on s.campaign_id = m.campaign_id and s.adset_id = m.adset_id and s.ad_id = m.ad_id
where coalesce(m.spend, 0) > 0 or coalesce(s.singular_installs, 0) > 0
order by coalesce(m.spend, 0) desc;

revoke all on public.mmp_ad_attribution from anon, authenticated;
grant select on public.mmp_ad_attribution to service_role;

create or replace view public.mmp_singular_paid as
with start as (
  select min(date) as first_date from public.singular_campaign_daily where paid_conversions > 0
)
select
  coalesce(sum(paid_conversions), 0) as sng_paid_35d,
  coalesce(sum(trial_starts) filter (where date >= start.first_date and date <= current_date - coalesce(nullif(regexp_replace(conversion_period, '\D', '', 'g'), '')::int, 14)), 0) as sng_trials_mature,
  coalesce(sum(paid_conversions) filter (where date >= start.first_date and date <= current_date - coalesce(nullif(regexp_replace(conversion_period, '\D', '', 'g'), '')::int, 14)), 0) as sng_paid_mature
from public.singular_campaign_daily, start
where date >= current_date - 35 and source = 'facebook';

revoke all on public.mmp_singular_paid from anon, authenticated;
grant select on public.mmp_singular_paid to service_role;
