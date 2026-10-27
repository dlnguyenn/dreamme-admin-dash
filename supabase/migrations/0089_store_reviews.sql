-- Store reviews: App Store + Google Play written reviews for DreamMe.
--
-- Why stored and not fetched live: the Google Play reviews API only returns
-- reviews created or edited in the last 7 days, so history only exists if we
-- keep it. /api/cron/sync-store-reviews (daily) and the tab's Sync button
-- upsert here; src/lib/store-reviews.ts decides what needs attention.
--
-- One row per review. Sync only writes the store's own fields, so
-- first_seen_at and handled_at survive every re-sync. A review edited after
-- handled_at (both stores move the review date on an edit) needs attention again.
create table if not exists public.store_reviews (
  id text primary key,                  -- '<store>:<review_id>'
  store text not null check (store in ('app_store','google_play')),
  review_id text not null,
  rating int not null check (rating between 1 and 5),
  title text,                           -- App Store only
  body text not null default '',
  reviewer text,
  territory text,                       -- App Store territory code (USA, GBR, ...)
  language text,                        -- Play reviewer language
  app_version text,                     -- Play only
  device text,                          -- Play only
  reviewed_at timestamptz not null,     -- App Store createdDate; Play last edit
  reply_body text,
  replied_at timestamptz,
  reply_state text,                     -- App Store response state (PUBLISHED, PENDING_PUBLISH)
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  handled_at timestamptz                -- set by "Mark handled" in the tab
);

create index if not exists store_reviews_reviewed_idx
  on public.store_reviews (reviewed_at desc);

comment on table public.store_reviews is
  'App Store + Google Play written reviews, synced daily; handled_at is the DAD triage flag.';

alter table public.store_reviews enable row level security;
-- service-role only.
