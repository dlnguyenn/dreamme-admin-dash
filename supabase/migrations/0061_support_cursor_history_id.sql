-- Gmail API ingestion cursor.
--
-- The IMAP transport cursors on (uidvalidity, last_uid). The Gmail API has
-- no UIDs — it has a monotonic historyId per mailbox. Storing it in last_uid
-- would work numerically and lie semantically, so it gets its own column.
--
-- text, not bigint: Gmail documents historyId as an unsigned 64-bit value and
-- returns it as a string. Round-tripping it through a JS number would start
-- losing precision above 2^53.
alter table support_cursors
  add column if not exists history_id text;

comment on column support_cursors.history_id is
  'Gmail API historyId cursor (support/gmail-ingest.ts). Null for IMAP cursors.';
