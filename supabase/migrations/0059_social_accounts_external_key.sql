-- Make (source, external_id) an ON CONFLICT-targetable key.
--
-- 0057 created it as a PARTIAL unique index (`where external_id is not null`).
-- Two problems with that:
--   1. Postgres can only infer a partial index for ON CONFLICT when the
--      statement repeats the predicate, which PostgREST's on_conflict= cannot
--      express — so the sync could never upsert against it.
--   2. The predicate was redundant. Postgres already treats NULLs as distinct
--      in a unique index, so a plain unique index permits any number of rows
--      with a null external_id, exactly like the partial one did.
--
-- Why this matters: the vendor's account id is the only stable identity. The
-- Doublespeed sync first ran 2026-08-05 and hit a 23505 on this index because
-- the Facebook account 838e94f6… had been renamed glp1tips -> glp1tipss since
-- the seed was taken. Keyed on (source, platform, handle) a rename looks like a
-- brand-new account and collides on external_id; keyed on (source, external_id)
-- it is simply a handle update, which is what it is.
drop index if exists public.social_accounts_external_idx;

create unique index if not exists social_accounts_external_idx
  on public.social_accounts (source, external_id);
