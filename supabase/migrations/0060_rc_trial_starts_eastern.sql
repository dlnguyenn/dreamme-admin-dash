-- Bucket daily trial starts by US Eastern, not UTC.
--
-- 0058 grouped on (event_at at time zone 'utc')::date. That makes the day roll
-- over at 8pm Eastern during EDT (7pm during EST): at 03:05 UTC on 2026-08-05
-- the "today" bucket had already advanced to Aug 5 while it was still 23:05 on
-- Tuesday Aug 4 for the team reading it. The north-star tile appeared to reset
-- mid-evening and the last four to five hours of every business day were filed
-- under tomorrow.
--
-- America/New_York rather than a fixed -05:00, deliberately: the zone follows
-- EDT/EST automatically, so the boundary stays at local midnight through the
-- November and March transitions instead of drifting by an hour twice a year.
-- (Dan said "EST"; the intent is US Eastern wall-clock, which is what this is.)
create or replace view public.rc_trial_starts_daily
  with (security_invoker = on) as
select
  (event_at at time zone 'America/New_York')::date as date,
  count(*)::int                                    as trial_starts
from public.rc_events
where type = 'INITIAL_PURCHASE'
  and period_type = 'TRIAL'
  and coalesce(environment, '') <> 'SANDBOX'
group by 1;
