-- Daily trial starts counted from the RevenueCat webhook feed.
--
-- WHY NOT rc_account_metrics_daily.trial_starts: that table is written by a
-- once-a-day cron pulling RC's rollup, so its newest row is a snapshot of a
-- day still in progress. Observed 2026-08-05: the 2026-08-04 row was written
-- at 11:00 UTC on the 4th and recorded 29 trial starts, against a 76.3 average
-- for the prior week — a 62% "drop" that was purely an artefact of the sync
-- time. Reading that as the north-star number is worse than useless; it's a
-- false alarm on the metric the day gets judged by.
--
-- rc_events is event-sourced from the webhook, so any completed day is
-- complete. A trial start is INITIAL_PURCHASE with period_type TRIAL;
-- SANDBOX events are TestFlight noise, not customers.
--
-- security_invoker so it inherits rc_events' RLS (service-role only) rather
-- than quietly becoming an anon-readable path.
create or replace view public.rc_trial_starts_daily
  with (security_invoker = on) as
select
  (event_at at time zone 'utc')::date as date,
  count(*)::int                       as trial_starts
from public.rc_events
where type = 'INITIAL_PURCHASE'
  and period_type = 'TRIAL'
  and coalesce(environment, '') <> 'SANDBOX'
group by 1;
