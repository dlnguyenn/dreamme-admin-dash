-- PostgREST on_conflict=message_id needs a full (non-partial) unique
-- constraint for ON CONFLICT inference; the 0051 partial index can't be
-- used. A plain unique index behaves identically here because Postgres
-- treats NULLs as distinct (feedback messages have message_id = null).

drop index if exists support_messages_message_id_key;
create unique index if not exists support_messages_message_id_key
  on support_messages (message_id);
