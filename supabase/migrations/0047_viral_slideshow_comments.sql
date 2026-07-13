-- Add top comments to each viral slideshow. Stored as an array of
-- { text, likes, username, created, pinned, reply_count } objects, sorted
-- by likes desc (top comments first). Scraped via the dedicated
-- clockworks tiktok-comments-scraper actor at collect time (and on demand
-- via the refresh-comments endpoint for backfill).

alter table public.viral_slideshows
  add column if not exists comments jsonb not null default '[]'::jsonb;
