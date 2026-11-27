-- asa_rc_events (0120) scanned every RevenueCat event's raw JSON: 6.4 s on
-- 39k rows, past PostgREST's statement timeout. Only trial starts are needed
-- (the tab counts trials, and "attribution proven" = the first attributed
-- trial), and limiting to them lets Postgres use rc_events_trial_starts_idx:
-- 0.45 s for 120 days.
create or replace view public.asa_rc_events
with (security_invoker = true) as
select
  e.id,
  e.type,
  e.period_type,
  e.event_at,
  e.app_user_id,
  e.product_id,
  e.price_usd,
  e.raw->'event'->'subscriber_attributes'->'$campaign'->>'value' as asa_campaign,
  e.raw->'event'->'subscriber_attributes'->'$adGroup'->>'value'  as asa_ad_group,
  e.raw->'event'->'subscriber_attributes'->'$keyword'->>'value'  as asa_keyword
from public.rc_events e
where e.type = 'INITIAL_PURCHASE'
  and e.period_type = 'TRIAL'
  and e.raw->'event'->'subscriber_attributes'->'$mediaSource'->>'value' = 'Apple Search Ads'
  and coalesce(e.environment, 'PRODUCTION') = 'PRODUCTION';

revoke all on public.asa_rc_events from anon, authenticated;
