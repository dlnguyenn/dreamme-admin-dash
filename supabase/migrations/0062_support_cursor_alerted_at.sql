-- Staleness-alert state for the ingest cursors.
--
-- 2026-08-06: a deleted Gmail message made the email leg throw on every run.
-- The cursor stopped advancing for eleven hours while the poller kept running
-- and the sent leg kept succeeding, so nothing looked wrong and three user
-- emails sat unread. The signal that would have caught it is simply "this
-- cursor has not moved in an hour".
--
-- alerted_at records when we last warned about THIS cursor being stuck, so a
-- 20-minute poll doesn't send the same warning three times an hour. It is
-- cleared whenever the cursor advances again.
alter table support_cursors
  add column if not exists alerted_at timestamptz;

comment on column support_cursors.alerted_at is
  'When we last alerted that this cursor was stuck (support/health.ts). Cleared on advance.';
