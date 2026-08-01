-- Keep the sender's display name per message.
--
-- The thread's counterpart_name is captured once, when the thread is
-- created, so a fuller name on a later reply was lost. Names are the only
-- way to find a Stripe customer who writes from a different address than
-- the card on file (Stripe cannot be searched by name), so every name we
-- ever see is worth keeping.

alter table support_messages add column if not exists from_name text;
