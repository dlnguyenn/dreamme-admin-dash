-- Competitor Ad Tracker — enter a competitor's brand name, pull their Meta
-- Ad Library ads via ScrapeCreators, AI-analyze each one, and monitor for
-- new launches on the Tue/Fri scrape cadence.

-- 1) Tracked brands. UI CRUD (anon read+write, same as app_watchlist —
--    the dash sits behind the shared-password gate).
create table if not exists public.competitor_brands (
  id uuid primary key default gen_random_uuid(),
  page_id text not null unique,
  page_name text not null,
  brand_name text,                 -- what the user typed in search
  category text,
  notes text,
  active boolean not null default true,
  added_at timestamptz not null default now(),
  last_scraped_at timestamptz,
  last_ad_count int,               -- ads returned on the last scrape
  new_last_scrape int              -- NEW ads found on the last scrape (badge)
);

alter table public.competitor_brands enable row level security;
drop policy if exists "competitor_brands_anon_read" on public.competitor_brands;
drop policy if exists "competitor_brands_anon_write" on public.competitor_brands;
create policy "competitor_brands_anon_read" on public.competitor_brands
  for select using (true);
create policy "competitor_brands_anon_write" on public.competitor_brands
  for all using (true) with check (true);

-- 2) Their ads. Service-role writes only (0039 pattern); ended ads persist
--    once seen — that's the monitoring value.
create table if not exists public.competitor_ads (
  id uuid primary key default gen_random_uuid(),
  ad_archive_id text not null unique,
  page_id text not null,
  page_name text,
  is_active boolean not null default true,
  started_at timestamptz,
  ended_at timestamptz,
  media_type text,                 -- image | video | dco | unknown
  media_url text,                  -- original CDN url (expires)
  thumbnail_url text,              -- re-hosted to dreamme-admin-internal-images
  body text,
  title text,
  cta_text text,
  cta_type text,
  link_url text,
  ad_library_url text,
  publisher_platforms text[],
  -- AI analysis (Haiku, thumbnail + copy)
  format text,
  angle text,
  hook text,
  offer text,
  why_notable text,
  analyzed_at timestamptz,
  -- lifecycle
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists competitor_ads_page_idx
  on public.competitor_ads (page_id, first_seen_at desc);
create index if not exists competitor_ads_first_seen_idx
  on public.competitor_ads (first_seen_at desc);
create index if not exists competitor_ads_started_idx
  on public.competitor_ads (started_at desc);

alter table public.competitor_ads enable row level security;
drop policy if exists "competitor_ads_anon_read" on public.competitor_ads;
create policy "competitor_ads_anon_read" on public.competitor_ads
  for select using (true);

-- 3) Seed: MeAgain (page_id verified from the earlier ad-library teardown).
--    Other competitors get added via the in-dash brand search.
insert into public.competitor_brands (page_id, page_name, brand_name, category, notes) values
  ('539227915950887', 'MeAgain App', 'MeAgain', 'glp1', 'all-in-one GLP-1 tracker; teardown 2026-06')
on conflict (page_id) do nothing;
