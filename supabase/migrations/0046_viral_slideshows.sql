-- "Viral Slideshows" tab: admin pastes a TikTok slideshow (photo) URL and we
-- scrape every slide image into our own Storage bucket for later analysis of
-- what viral GLP-1 slideshows look like slide-by-slide. Unlike the Resources
-- "References" tool, this captures the virality metrics (play/like/comment/
-- share counts, post date) so we can study winners over time.
-- TikTok CDN URLs expire, so every slide image is re-hosted under
-- `dreamme-admin-internal-images/viral-slideshows/{id}/slide-{i}-{short}.jpg`.

create table if not exists public.viral_slideshows (
  id uuid primary key default gen_random_uuid(),
  tiktok_url text not null,
  author_username text,
  caption text,
  -- Virality metrics from the scraper (nullable — TikTok can hide counts).
  play_count bigint,
  digg_count bigint,
  comment_count bigint,
  share_count bigint,
  -- Original post timestamp (from Apify createTimeISO).
  post_created_at timestamptz,
  slide_count int not null default 0,
  -- Array of { image_url: text } objects in slide order.
  slides jsonb not null default '[]'::jsonb,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Dedup on URL: a repeat paste hits the unique index, not a duplicate row.
create unique index if not exists viral_slideshows_tiktok_url_idx
  on public.viral_slideshows (tiktok_url);
create index if not exists viral_slideshows_created_at_idx
  on public.viral_slideshows (created_at desc);
