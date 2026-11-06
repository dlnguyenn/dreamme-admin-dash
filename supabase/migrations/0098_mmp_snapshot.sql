-- 0098: read models for the MMP tab (the in-house AppsFlyer comparison).
--
-- mmp_snapshot is one row of 35-day counts from every attribution pipe we run:
-- RevenueCat trials and how many we can tie to an install and to an ad click,
-- the first-party click and install tables, SKAN postbacks, Meta's own claims,
-- Singular, the CAPI senders, TikTok, audiences, alerts and the onboarding survey.
-- The tab turns these into a status per AppsFlyer module (src/lib/mmp/parity.ts).
--
-- mmp_campaign_attribution puts every attribution method side by side per campaign.
--
-- Both read service-role-only tables (attr_*, skan_postbacks) and carry spend, so
-- they are readable by the service role only; the tab reads them through /api/mmp.

create or replace view public.mmp_snapshot as
with trials as (
  select e.store,
         (i.install_id is not null) as has_install,
         (i.matched_click_id is not null) as click_matched
  from public.rc_events e
  left join public.attr_installs i on i.install_id::text = e.dm_install_id
  where e.type = 'INITIAL_PURCHASE' and e.period_type = 'TRIAL' and e.environment = 'PRODUCTION'
    and e.event_at >= now() - interval '35 days'
),
inst as (
  select platform, matched_click_id, first_open_at, raw
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
survey as (
  select referral_source
  from public.user_sources
  where onboarding_completed_at >= now() - interval '35 days'
)
select
  now() as generated_at,
  -- RevenueCat trials, and how far down the attribution chain each one gets
  (select count(*) from trials) as trials,
  (select count(*) filter (where store = 'APP_STORE') from trials) as trials_ios,
  (select count(*) filter (where store = 'PLAY_STORE') from trials) as trials_android,
  (select count(*) filter (where has_install) from trials) as trials_with_install,
  (select count(*) filter (where click_matched) from trials) as trials_click_matched,
  -- first-party install pings and click redirects
  (select count(*) from inst) as installs,
  (select count(*) filter (where platform = 'ios') from inst) as installs_ios,
  (select count(*) filter (where platform = 'android') from inst) as installs_android,
  (select count(*) filter (where matched_click_id is not null) from inst) as installs_matched,
  (select count(*) filter (where platform = 'android' and raw ? 'install_referrer') from inst) as android_with_referrer,
  (select max(first_open_at) from inst) as last_install_at,
  (select count(*) from clk) as clicks,
  (select count(*) filter (where campaign_id ~ '^[0-9]+$') from clk) as clicks_tagged,
  (select max(clicked_at) from public.attr_clicks where campaign_id ~ '^[0-9]+$') as last_tagged_click_at,
  -- SKAN
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
  -- what Meta says about itself
  (select coalesce(spend, 0) from meta) as meta_spend,
  (select coalesce(installs, 0) from meta) as meta_installs,
  (select coalesce(trials, 0) from meta) as meta_trials,
  (select last_date from meta) as meta_last_date,
  (select coalesce(paid, 0) from rc) as rc_paid,
  (select coalesce(revenue, 0) from rc) as rc_revenue,
  -- Singular (the paid MMP whose SDK already ships in the app)
  (select coalesce(tracker_installs, 0) from sng) as sng_tracker_installs,
  (select coalesce(trials, 0) from sng) as sng_trials,
  (select coalesce(spend, 0) from sng) as sng_spend,
  (select synced_at from sng) as sng_synced_at,
  -- events we send back to the ad networks
  (select count(*) from public.capi_trial_qualified_log where created_at >= now() - interval '35 days') as capi_qualified,
  (select count(*) from public.capi_trial_qualified_log where created_at >= now() - interval '35 days' and status = 'sent') as capi_qualified_sent,
  (select max(created_at) from public.capi_trial_qualified_log) as capi_qualified_last,
  (select count(*) from public.capi_trial_engaged_log where created_at >= now() - interval '35 days') as capi_engaged,
  (select max(created_at) from public.capi_trial_engaged_log) as capi_engaged_last,
  (select count(*) from public.attr_capi_log where created_at >= now() - interval '35 days') as capi_attr,
  (select max(created_at) from public.attr_capi_log) as capi_attr_last,
  (select count(*) from public.tiktok_event_outbox) as tiktok_events,
  (select count(*) from public.tiktok_event_outbox where status = 'sent') as tiktok_events_sent,
  -- cost coverage beyond Meta
  (select max(date) from public.tiktok_ad_insights_daily) as tiktok_cost_last_date,
  (select count(*) from public.manual_channel_spend where date >= current_date - 35) as manual_spend_rows,
  -- audiences
  (select count(*) from public.meta_audience_registry) as aud_audiences,
  (select coalesce(max(member_count), 0) from public.meta_audience_registry where kind = 'suppression') as aud_suppression_members,
  (select count(*) from public.rc_customer_snapshot) as aud_snapshot_rows,
  (select max(last_run_at) from public.rc_customer_snapshot) as aud_snapshot_last_run,
  -- alerts and cohorts
  (select count(*) from public.marketing_alerts where resolved_at is null) as alerts_open,
  (select max(alert_date) from public.marketing_alerts) as alerts_last_date,
  (select count(*) from public.payer_retention_cohorts) as retention_cohorts,
  -- onboarding survey ("how did you hear about us")
  (select count(*) from survey) as survey_total,
  (select count(*) filter (where referral_source = 'facebook') from survey) as survey_facebook,
  (select count(*) filter (where referral_source = 'instagram') from survey) as survey_instagram,
  (select count(*) filter (where referral_source = 'tiktok') from survey) as survey_tiktok,
  (select count(*) filter (where referral_source = 'app_store') from survey) as survey_app_store;

create or replace view public.mmp_campaign_attribution as
with spend as (
  select campaign_id, max(campaign_name) as campaign_name, sum(spend) as spend,
         sum(installs) as meta_installs, sum(trial_starts) as meta_trials
  from public.ad_insights_daily
  where date >= current_date - 35
  group by campaign_id
),
skan as (
  select campaign_id, skan_trials
  from public.skan_campaign_efficiency
  where campaign_id is not null
),
clicks as (
  select campaign_id, count(*) as clicks
  from public.attr_clicks
  where clicked_at >= now() - interval '35 days' and campaign_id ~ '^[0-9]+$'
  group by campaign_id
),
matched as (
  select c.campaign_id, count(*) as matched_installs
  from public.attr_installs i
  join public.attr_clicks c on c.click_id = i.matched_click_id
  where i.first_open_at >= now() - interval '35 days' and c.campaign_id ~ '^[0-9]+$'
  group by c.campaign_id
),
trials as (
  select c.campaign_id, count(distinct e.original_transaction_id) as matched_trials
  from public.rc_events e
  join public.attr_installs i on i.install_id::text = e.dm_install_id
  join public.attr_clicks c on c.click_id = i.matched_click_id
  where e.type = 'INITIAL_PURCHASE' and e.period_type = 'TRIAL' and e.environment = 'PRODUCTION'
    and e.event_at >= now() - interval '35 days' and c.campaign_id ~ '^[0-9]+$'
  group by c.campaign_id
),
sng as (
  select campaign_id, sum(tracker_installs) as singular_installs, sum(trial_starts) as singular_trials
  from public.singular_campaign_daily
  where date >= current_date - 35 and source = 'facebook'
  group by campaign_id
)
select
  s.campaign_id,
  s.campaign_name,
  s.spend,
  s.meta_installs,
  s.meta_trials,
  sk.skan_trials,
  coalesce(cl.clicks, 0) as clicks,
  coalesce(m.matched_installs, 0) as matched_installs,
  coalesce(t.matched_trials, 0) as matched_trials,
  coalesce(sg.singular_installs, 0) as singular_installs,
  coalesce(sg.singular_trials, 0) as singular_trials
from spend s
left join skan sk on sk.campaign_id = s.campaign_id
left join clicks cl on cl.campaign_id = s.campaign_id
left join matched m on m.campaign_id = s.campaign_id
left join trials t on t.campaign_id = s.campaign_id
left join sng sg on sg.campaign_id = s.campaign_id
where s.spend > 0
order by s.spend desc;

revoke all on public.mmp_snapshot from anon, authenticated;
revoke all on public.mmp_campaign_attribution from anon, authenticated;
grant select on public.mmp_snapshot to service_role;
grant select on public.mmp_campaign_attribution to service_role;
