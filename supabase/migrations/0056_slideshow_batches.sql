-- Daily TikTok persona batches drafted by the pipeline in
-- C:\Users\Dan\Documents\DreamMe\claude. Each batch is nine single-slide
-- persona posts queued to Doublespeed.
--
-- Rows are pushed by claude/scripts/publish-batch-to-dash.py — Vercel can't
-- read Dan's disk, so the local script crops the batch's contact sheet into
-- nine tiles, uploads them to
-- dreamme-admin-internal-images/slideshow-batches/<batch_key>/<i>-<persona>.jpg,
-- and upserts these rows. Read back by /api/slideshow-batches.
--
-- Deliberately NOT reusing viral_slideshows: that table models one row = one
-- deck of N ordered slides, while a batch is nine independent posts each with
-- its own hook, engine, sound, tier and review link. It also splits its two
-- existing views on platform=eq.generated vs platform=neq.generated, so any
-- third platform value would silently leak into the competitor-research tab.
--
-- Both tables are SERVICE-ROLE ONLY (RLS on, no policy) — reads go through the
-- API route, same as the clippers tables in 0045.

-- 1) One row per batch. batch_key ('virality28') is the natural key the
--    publisher upserts on, so it can write all nine posts in one request
--    without first reading back a generated uuid.
create table if not exists public.slideshow_batches (
  id uuid primary key default gen_random_uuid(),
  batch_key text not null unique,             -- 'virality28'
  batch_no int,                               -- 28, parsed off batch_key for ordering
  batch_date date not null,
  status text,                                -- 'QUEUED (all 9, scheduledAt=null); ...'
  account_scope text,
  experiment text,                            -- the batch thesis, when it runs one
  note text,
  render_note text,
  copy_md text,                               -- full copy/batch-<date>-<key>.md
  post_count int not null default 0,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists slideshow_batches_order_idx
  on public.slideshow_batches (batch_date desc, batch_no desc);

alter table public.slideshow_batches enable row level security;

-- 2) Nine rows per batch, one per persona. Every column except persona is
--    nullable on purpose: field names drifted across batch vintages
--    (format -> engine at v14, cta added at v22, tier/caption_chars at v28),
--    so backfilled older batches legitimately carry nulls.
create table if not exists public.slideshow_batch_posts (
  id uuid primary key default gen_random_uuid(),
  batch_key text not null
    references public.slideshow_batches (batch_key) on delete cascade,
  persona text not null,                      -- matches src/lib/personas.ts PersonaId
  sort_order int not null default 0,          -- tile index within the contact sheet
  hook text,
  second_line text,
  engine text,
  cta text,
  sound text,
  tier text,                                  -- SHORT | MED | LONG
  caption_chars int,
  caption text,
  review_url text,                            -- Doublespeed review link
  doublespeed_group_id text,
  doublespeed_post_id text,
  image_url text,                             -- cropped tile; null when no sheet exists
  created_at timestamptz not null default now(),
  unique (batch_key, persona)
);

create index if not exists slideshow_batch_posts_batch_idx
  on public.slideshow_batch_posts (batch_key, sort_order);

alter table public.slideshow_batch_posts enable row level security;
