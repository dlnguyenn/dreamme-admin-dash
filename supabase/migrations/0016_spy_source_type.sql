-- Spy Tool Option 2: free-text search queries scraped alongside hashtags.
-- The scrape handler now hits Apify clockworks/tiktok-scraper twice per
-- run — once with hashtags: [...], once with searchQueries: [...]. Both
-- write to spy_videos. We add source_type so the UI / trends can split
-- the two streams.
--
-- Existing rows backfill to 'hashtag' via the column default.

alter table public.spy_videos
  add column if not exists source_type text not null default 'hashtag'
  check (source_type in ('hashtag','search'));

create index if not exists spy_videos_source_type_idx
  on public.spy_videos (source_type, posted_at desc);
