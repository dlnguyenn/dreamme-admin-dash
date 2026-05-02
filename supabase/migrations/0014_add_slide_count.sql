-- Track how many slides each scraped TikTok post has, so the dashboard
-- can break out views by post type (transformation slideshow > 1 slide
-- vs. single-slide photo post). Apify already returns the slide URLs in
-- slideshowImageLinks; we now persist the count from
-- src/lib/handlers/scrape-tiktok.ts during upsert.
--
-- Existing rows get NULL — backfill happens naturally as posts are
-- re-scraped on the daily 06:00 UTC tick. The dashboard treats NULL as
-- "unclassified" and excludes it from the breakdown buckets.

alter table public.tiktok_posts
  add column if not exists slide_count int;

create index if not exists tiktok_posts_slide_count_idx
  on public.tiktok_posts (persona, slide_count, posted_at desc)
  where slide_count is not null;
