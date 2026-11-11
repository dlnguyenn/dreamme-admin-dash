-- Trial starts kept vanishing from the DAD (Overview hero card and the Paid
-- table) with "canceling statement due to statement timeout" (2026-11-10).
-- rc_trial_starts_daily (migration 0060) counts trials across all history,
-- and its date filter is on an Eastern-time expression no index can use, so
-- every call read every INITIAL_PURCHASE row of rc_events (~5,700 heap pages
-- of raw webhook payloads). Usually ~0.3 s; when the Overview's dozen
-- parallel reads pile up, it crossed PostgREST's 8 s limit.
--
-- This partial index holds only trial starts and carries every column the
-- view reads, so the view becomes an index-only scan over ~2,000 small
-- entries instead of the raw payload table. The view itself is unchanged.
create index if not exists rc_events_trial_starts_idx
  on public.rc_events (event_at)
  include (environment)
  where type = 'INITIAL_PURCHASE' and period_type = 'TRIAL';

analyze public.rc_events;
