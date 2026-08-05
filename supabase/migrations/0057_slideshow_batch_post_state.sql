-- Real post state for daily batch posts.
--
-- 0056 stored doublespeed_post_id and a free-text `status` snapshot, both
-- written once by claude/scripts/publish-batch-to-dash.py at publish time and
-- never updated. Overview then rendered "N/M QUEUED" from
-- `!!doublespeed_post_id`, which only ever meant "we handed this to Doublespeed
-- at some point" — so a batch that had already gone out still read as queued,
-- indefinitely. These columns hold the live state instead, refreshed from the
-- Doublespeed REST API by src/lib/batchState.ts.
--
-- All nullable: a row that has never been synced must read as UNKNOWN rather
-- than defaulting to a state we haven't verified. That distinction is the
-- entire point of this migration.

alter table public.slideshow_batch_posts
  add column if not exists post_status text,        -- scheduled | posted | draft | failed | ...
  add column if not exists posted_at timestamptz,   -- succeeded_at, else the scheduled slot
  add column if not exists public_post_url text,
  add column if not exists state_synced_at timestamptz;

-- Sync reads "which rows are stale" on every Overview build.
create index if not exists slideshow_batch_posts_state_sync_idx
  on public.slideshow_batch_posts (state_synced_at nulls first);
