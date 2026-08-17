-- 0068: record Expo push RECEIPTS, not just tickets.
--
-- WHY: expo_status='ok' in 0067 means only that Expo ACCEPTED the message for
-- delivery. It says nothing about whether APNs delivered it. Real failures —
-- DeviceNotRegistered, InvalidCredentials (the P8-deletion class of incident),
-- MessageRateExceeded, MismatchSenderId — appear ONLY in Expo's receipts API,
-- fetched by ticket id ~15 min after send. Without this we were reporting
-- "17 pushes sent" while having no evidence any device woke up.
--
-- expo_detail already holds the ticket id for rows with expo_status='ok';
-- the cron's second pass resolves those into receipt_status here.

alter table public.trial_ping_log
  add column if not exists receipt_status     text,
  add column if not exists receipt_detail     text,
  add column if not exists receipt_checked_at timestamptz;

-- Partial index for the poller's working set: sent-but-unresolved rows.
create index if not exists trial_ping_log_pending_receipt_idx
  on public.trial_ping_log (claimed_at)
  where expo_status = 'ok' and receipt_status is null;

comment on column public.trial_ping_log.receipt_status is
  'Expo receipt outcome: ok | error:<ExpoErrorCode> | unresolved_expired. NULL = not yet checked. This — not expo_status — is delivery truth.';
