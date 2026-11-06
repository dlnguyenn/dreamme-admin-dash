-- 0099: Singular by ad set and ad, and two more inputs for the MMP tab.
--
-- singular_ad_daily: Singular's installs, trials and subscribes per Meta ad set
-- and ad, per day (the sync-singular cron fills it beside singular_campaign_daily).
-- Singular's adn_sub_campaign_id / adn_creative_id are Meta's ad set and ad ids
-- (checked 2026-11-05), so rows join to ad_insights_daily. ad_id is '' where
-- Singular reports the ad as "N/A". Service role only, like attr_installs.
--
-- mmp_ad_attribution: per ad, Meta's spend and claimed trials next to Singular's.
--
-- mmp_snapshot gains five columns at the end (create or replace keeps the
-- existing ones): installs and trials whose Meta deferred deep link names the
-- campaign and ad, Singular's ad-level trial totals, and the onboarding
-- survey's friend-or-family count.

create table if not exists public.singular_ad_daily (
  source        text not null,
  campaign_id   text not null,
  adset_id      text not null default '',
  ad_id         text not null default '',
  date          date not null,
  campaign_name text,
  adset_name    text,
  ad_name       text,
  os            text,
  installs      integer not null default 0,
  trial_starts  integer not null default 0,
  subscribes    integer not null default 0,
  cohort_period text,
  synced_at     timestamptz not null default now(),
  primary key (source, campaign_id, adset_id, ad_id, date)
);

alter table public.singular_ad_daily enable row level security;
revoke all on public.singular_ad_daily from anon, authenticated;
grant all on public.singular_ad_daily to service_role;

create index if not exists singular_ad_daily_date_idx on public.singular_ad_daily (date);

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
         sum(installs) as singular_installs, sum(trial_starts) as singular_trials
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
  coalesce(s.singular_trials, 0) as singular_trials
from meta m
full join sng s
  on s.campaign_id = m.campaign_id and s.adset_id = m.adset_id and s.ad_id = m.ad_id
where coalesce(m.spend, 0) > 0 or coalesce(s.singular_installs, 0) > 0
order by coalesce(m.spend, 0) desc;

revoke all on public.mmp_ad_attribution from anon, authenticated;
grant select on public.mmp_ad_attribution to service_role;

create or replace view public.mmp_snapshot as
with trials as (
  select e.store,
         e.dm_install_id,
         (i.install_id is not null) as has_install,
         (i.matched_click_id is not null) as click_matched
  from public.rc_events e
  left join public.attr_installs i on i.install_id::text = e.dm_install_id
  where e.type = 'INITIAL_PURCHASE' and e.period_type = 'TRIAL' and e.environment = 'PRODUCTION'
    and e.event_at >= now() - interval '35 days'
),
inst as (
  select install_id, platform, matched_click_id, first_open_at, raw,
         case when deferred_link ~ '^\s*\{' then deferred_link::jsonb end as deferred
  from public.attr_installs
  where first_open_at >= now() - interval '35 days'
),
clk as (
  select campaign_id, clicked_at
  from public.attr_clicks
  where clicked_at >= now() - interval '35 days'
),
pb as (
  select p.ad_network_id, p.signature_status, p.decoded_event, p.conversion_value, p.redownload,
         p.fidelity_type, p.postback_sequence_index, p.received_at,
         (m.id is not null or p.mapped_campaign_id is not null) as mapped
  from public.skan_postbacks p
  left join public.skan_campaign_mapping m
    on m.network = p.network and m.source_identifier = p.source_identifier
  where p.received_at >= current_date - 35
),
meta as (
  select sum(spend) as spend, sum(installs) as installs, sum(trial_starts) as trials, max(date) as last_date
  from public.ad_insights_daily
  where date >= current_date - 35
),
rc as (
  select sum(trial_conversions) as paid, sum(revenue) as revenue
  from public.rc_account_metrics_daily
  where date >= current_date - 35
),
sng as (
  select sum(tracker_installs) as tracker_installs, sum(trial_starts) as trials, sum(spend) as spend,
         max(synced_at) as synced_at
  from public.singular_campaign_daily
  where date >= current_date - 35
),
sng_ads as (
  select sum(trial_starts) filter (where ad_id <> '') as ad_trials,
         count(distinct ad_id) filter (where ad_id <> '' and trial_starts > 0) as ads_with_trials
  from public.singular_ad_daily
  where date >= current_date - 35
),
deferred as (
  select install_id
  from inst
  where deferred->>'mediaSource' in ('fb', 'facebook', 'ig', 'instagram')
    and deferred->>'ad' is not null
),
survey as (
  select referral_source
  from public.user_sources
  where onboarding_completed_at >= now() - interval '35 days'
)
select
  now() as generated_at,
  (select count(*) from trials) as trials,
  (select count(*) filter (where store = 'APP_STORE') from trials) as trials_ios,
  (select count(*) filter (where store = 'PLAY_STORE') from trials) as trials_android,
  (select count(*) filter (where has_install) from trials) as trials_with_install,
  (select count(*) filter (where click_matched) from trials) as trials_click_matched,
  (select count(*) from inst) as installs,
  (select count(*) filter (where platform = 'ios') from inst) as installs_ios,
  (select count(*) filter (where platform = 'android') from inst) as installs_android,
  (select count(*) filter (where matched_click_id is not null) from inst) as installs_matched,
  (select count(*) filter (where platform = 'android' and raw ? 'install_referrer') from inst) as android_with_referrer,
  (select max(first_open_at) from inst) as last_install_at,
  (select count(*) from clk) as clicks,
  (select count(*) filter (where campaign_id ~ '^[0-9]+$') from clk) as clicks_tagged,
  (select max(clicked_at) from public.attr_clicks where campaign_id ~ '^[0-9]+$') as last_tagged_click_at,
  (select count(*) from pb) as skan_postbacks,
  (select count(*) filter (where signature_status = 'valid') from pb) as skan_valid,
  (select count(*) filter (where decoded_event = 'trial_started') from pb) as skan_trials,
  (select count(*) filter (where conversion_value is null) from pb) as skan_cv_null,
  (select count(*) filter (where redownload) from pb) as skan_redownloads,
  (select count(*) filter (where fidelity_type = 0) from pb) as skan_view_through,
  (select count(*) filter (where postback_sequence_index > 0) from pb) as skan_later_windows,
  (select count(*) filter (where ad_network_id = 'com.apple.ads') from pb) as skan_apple_ads,
  (select count(*) filter (where ad_network_id <> 'com.apple.ads' and decoded_event is not null and not mapped) from pb) as skan_unmapped,
  (select max(received_at) from public.skan_postbacks) as last_postback_at,
  (select coalesce(spend, 0) from meta) as meta_spend,
  (select coalesce(installs, 0) from meta) as meta_installs,
  (select coalesce(trials, 0) from meta) as meta_trials,
  (select last_date from meta) as meta_last_date,
  (select coalesce(paid, 0) from rc) as rc_paid,
  (select coalesce(revenue, 0) from rc) as rc_revenue,
  (select coalesce(tracker_installs, 0) from sng) as sng_tracker_installs,
  (select coalesce(trials, 0) from sng) as sng_trials,
  (select coalesce(spend, 0) from sng) as sng_spend,
  (select synced_at from sng) as sng_synced_at,
  (select count(*) from public.capi_trial_qualified_log where created_at >= now() - interval '35 days') as capi_qualified,
  (select count(*) from public.capi_trial_qualified_log where created_at >= now() - interval '35 days' and status = 'sent') as capi_qualified_sent,
  (select max(created_at) from public.capi_trial_qualified_log) as capi_qualified_last,
  (select count(*) from public.capi_trial_engaged_log where created_at >= now() - interval '35 days') as capi_engaged,
  (select max(created_at) from public.capi_trial_engaged_log) as capi_engaged_last,
  (select count(*) from public.attr_capi_log where created_at >= now() - interval '35 days') as capi_attr,
  (select max(created_at) from public.attr_capi_log) as capi_attr_last,
  (select count(*) from public.tiktok_event_outbox) as tiktok_events,
  (select count(*) from public.tiktok_event_outbox where status = 'sent') as tiktok_events_sent,
  (select max(date) from public.tiktok_ad_insights_daily) as tiktok_cost_last_date,
  (select count(*) from public.manual_channel_spend where date >= current_date - 35) as manual_spend_rows,
  (select count(*) from public.meta_audience_registry) as aud_audiences,
  (select coalesce(max(member_count), 0) from public.meta_audience_registry where kind = 'suppression') as aud_suppression_members,
  (select count(*) from public.rc_customer_snapshot) as aud_snapshot_rows,
  (select max(last_run_at) from public.rc_customer_snapshot) as aud_snapshot_last_run,
  (select count(*) from public.marketing_alerts where resolved_at is null) as alerts_open,
  (select max(alert_date) from public.marketing_alerts) as alerts_last_date,
  (select count(*) from public.payer_retention_cohorts) as retention_cohorts,
  (select count(*) from survey) as survey_total,
  (select count(*) filter (where referral_source = 'facebook') from survey) as survey_facebook,
  (select count(*) filter (where referral_source = 'instagram') from survey) as survey_instagram,
  (select count(*) filter (where referral_source = 'tiktok') from survey) as survey_tiktok,
  (select count(*) filter (where referral_source = 'app_store') from survey) as survey_app_store,
  -- added in 0099
  (select count(*) from deferred) as installs_meta_deferred,
  (select count(*) from trials t join deferred d on d.install_id::text = t.dm_install_id) as trials_meta_deferred,
  (select coalesce(ad_trials, 0) from sng_ads) as sng_ad_trials,
  (select coalesce(ads_with_trials, 0) from sng_ads) as sng_ads_with_trials,
  (select count(*) filter (where referral_source = 'friend_family') from survey) as survey_friend_family;

revoke all on public.mmp_snapshot from anon, authenticated;
grant select on public.mmp_snapshot to service_role;
