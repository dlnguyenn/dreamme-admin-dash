-- Spy Tool — viral GLP-1 TikTok videos scraped from hashtag search.
-- Distinct from tiktok_posts (which holds OUR personas' posts). Daily
-- background scrape via Apify clockworks/tiktok-scraper in hashtag mode
-- writes here from /api/cron/scrape-spy at 03:00 UTC.

create table if not exists public.spy_videos (
  id uuid primary key default gen_random_uuid(),
  -- Source signal
  source_hashtag text not null,
  -- TikTok fields
  tiktok_id text,
  post_url text not null unique,
  author_handle text,
  posted_at timestamptz,
  -- Engagement
  view_count bigint not null default 0,
  like_count bigint not null default 0,
  comment_count bigint not null default 0,
  share_count bigint not null default 0,
  -- Content
  caption text,
  first_slide_url text,        -- re-hosted to dreamme-admin-internal-images bucket
  first_slide_text text,       -- OCR'd hook
  hook_normalized text,
  category text,               -- one of HOOK_CATEGORIES, classified by Haiku
  slide_count int,             -- 0=video, 1=single photo, >1=transformation slideshow
  -- Computed signal
  is_viral boolean not null default false,
  viral_first_seen_at timestamptz,
  -- Optional Haiku enrichment, lazy-computed on first card click
  why_it_hit text,
  -- Lifecycle
  last_scraped_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists spy_videos_viral_idx
  on public.spy_videos (is_viral, posted_at desc) where is_viral;
create index if not exists spy_videos_hashtag_idx
  on public.spy_videos (source_hashtag, posted_at desc);
create index if not exists spy_videos_category_idx
  on public.spy_videos (category, view_count desc);
create index if not exists spy_videos_views_idx
  on public.spy_videos (view_count desc);

create table if not exists public.spy_favorites (
  video_id uuid primary key references public.spy_videos(id) on delete cascade,
  notes text,
  saved_at timestamptz not null default now()
);

alter table public.spy_videos enable row level security;
drop policy if exists "spy_videos_anon_read" on public.spy_videos;
drop policy if exists "spy_videos_anon_write" on public.spy_videos;
create policy "spy_videos_anon_read" on public.spy_videos for select using (true);
create policy "spy_videos_anon_write" on public.spy_videos for all using (true) with check (true);

alter table public.spy_favorites enable row level security;
drop policy if exists "spy_favorites_anon_read" on public.spy_favorites;
drop policy if exists "spy_favorites_anon_write" on public.spy_favorites;
create policy "spy_favorites_anon_read" on public.spy_favorites for select using (true);
create policy "spy_favorites_anon_write" on public.spy_favorites for all using (true) with check (true);
