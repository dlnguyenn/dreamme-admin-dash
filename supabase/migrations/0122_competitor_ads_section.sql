-- Competitor ads tab (src/components/competitor-ads/). The tab reads the
-- tables Outlier's daily scrape already fills in this database
-- (competitor_brands, competitor_ads, competitor_ad_ranks,
-- competitor_brand_daily) and adds three of its own here.
--
-- The rows are loaded by scripts/import-competitor-archive.mjs from files in
-- the vault and never live in this repo, which is public. Every table is
-- service-role only: /api/competitor-ads.

-- One row per ad from an outside archive pull (Foreplay today). Run lengths
-- here are the archive's own, which hold up before Nov 5 2026, when Outlier
-- still scraped twice a week and end-dated ads late. Transcript text only:
-- media URLs from the archive are never stored.
create table if not exists public.competitor_archive_ads (
  ad_archive_id text primary key,
  page_id text not null,
  brand text not null,
  source text not null default 'foreplay',
  pulled_on date not null,
  started_at timestamptz,
  running_days integer,
  live_at_pull boolean,
  display_format text,
  identity text,
  headline text,
  description text,
  link_url text,
  video_duration_s numeric,
  transcript text,
  timed_transcript jsonb,
  product_mention_s numeric,
  archive_rank integer,
  archive_rank_prev integer,
  imported_at timestamptz not null default now()
);

create index if not exists competitor_archive_ads_page_idx
  on public.competitor_archive_ads (page_id, started_at);

comment on table public.competitor_archive_ads is
  'DAD Competitor ads tab: one row per ad from an archive pull (Foreplay), with run length and transcript. Service-role only.';

-- The ranked hook database: on-screen text of the first 3 seconds of
-- competitors' long-running videos, scored within each brand. pick is Dan's
-- call per hook.
create table if not exists public.competitor_hooks (
  id text primary key,
  position integer not null,
  tier text,
  score integer,
  brand text not null,
  hook text not null,
  hook_type text,
  visual text,
  style text,
  identity text,
  max_days integer,
  ads integer,
  live integer,
  video_s numeric,
  first_start date,
  ad_archive_id text,
  source_file text not null default '',
  pick text check (pick in ('brief', 'maybe', 'skip')),
  pick_at timestamptz,
  imported_at timestamptz not null default now()
);

create index if not exists competitor_hooks_position_idx
  on public.competitor_hooks (position);

comment on table public.competitor_hooks is
  'DAD Competitor ads tab: ranked competitor video hooks with a Pick column (brief / maybe / skip). Service-role only.';

-- Ads saved to the swipe file, with an optional note.
create table if not exists public.competitor_ad_saves (
  ad_archive_id text primary key,
  page_id text not null,
  note text not null default '',
  saved_by text not null default '',
  saved_at timestamptz not null default now()
);

comment on table public.competitor_ad_saves is
  'DAD Competitor ads tab: competitor ads saved to the swipe file. Service-role only.';

alter table public.competitor_archive_ads enable row level security;
alter table public.competitor_hooks enable row level security;
alter table public.competitor_ad_saves enable row level security;
revoke all on public.competitor_archive_ads from anon, authenticated;
revoke all on public.competitor_hooks from anon, authenticated;
revoke all on public.competitor_ad_saves from anon, authenticated;
