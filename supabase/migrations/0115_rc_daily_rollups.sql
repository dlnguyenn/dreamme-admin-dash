-- Daily rollups for the shipped-change readout (src/lib/change-impact-data.ts).
--
-- Counted here rather than in the app because PostgREST caps a plain select at
-- 1,000 rows: 160 days of cancellations is roughly nine thousand, which would
-- have come back silently truncated and read as a collapse in cancels.
--
-- Eastern days, to match every other day boundary in the dashboard.

create or replace view public.rc_cancels_daily as
select (event_at at time zone 'America/New_York')::date as day,
       count(*)::int as cancels
from public.rc_events
where environment = 'PRODUCTION'
  and store in ('APP_STORE', 'PLAY_STORE')
  and type = 'CANCELLATION'
  and cancel_reason = 'UNSUBSCRIBE'
group by 1;

comment on view public.rc_cancels_daily is
  'Customer-initiated cancellations (auto-renew off) per Eastern day. Refunds (cancel_reason CUSTOMER_SUPPORT) are not cancellations and are excluded.';

-- A renewal carrying a save, win-back or retention offer code: the offer was
-- taken and paid for, which is the only hard evidence a save offer worked.
create or replace view public.rc_save_offers_daily as
select (event_at at time zone 'America/New_York')::date as day,
       count(*)::int as redemptions
from public.rc_events
where environment = 'PRODUCTION'
  and store in ('APP_STORE', 'PLAY_STORE')
  and type = 'RENEWAL'
  and offer_code is not null
  and (offer_code ilike '%save%' or offer_code ilike '%winback%' or offer_code ilike '%retain%')
group by 1;

comment on view public.rc_save_offers_daily is
  'Renewals on a save, win-back or retention offer code, per Eastern day. A few a month, so read it as a rolling week.';

revoke all on public.rc_cancels_daily from anon, authenticated;
revoke all on public.rc_save_offers_daily from anon, authenticated;
