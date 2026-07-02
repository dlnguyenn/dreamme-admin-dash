-- Viral App Inspo — SaaS/consumer-app content that went viral organically
-- on TikTok (Instagram in phase 2). Scraped 2x/week from a curated
-- watchlist of app brand accounts + discovery hashtags, floor 50k views,
-- classified/enriched by Haiku (app? format? hook? why it hit).
--
-- Distinct from spy_videos (GLP-1 niche content): this tracks what OTHER
-- APPS are doing that works, as creative inspiration for DreamMe.

-- 1) The watchlist. UI CRUD in the dashboard (anon write, matches the
--    spy_favorites pattern — the dash sits behind the shared-password gate).
create table if not exists public.app_watchlist (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('tiktok','instagram')),
  handle text not null,
  app_name text not null,
  category text,
  notes text,
  active boolean not null default true,
  added_at timestamptz not null default now(),
  last_scraped_at timestamptz,
  -- posts returned on the last scrape; 0 repeatedly = dead/wrong handle
  last_result_count int,
  unique (platform, handle)
);

alter table public.app_watchlist enable row level security;
drop policy if exists "app_watchlist_anon_read" on public.app_watchlist;
drop policy if exists "app_watchlist_anon_write" on public.app_watchlist;
create policy "app_watchlist_anon_read" on public.app_watchlist
  for select using (true);
create policy "app_watchlist_anon_write" on public.app_watchlist
  for all using (true) with check (true);

-- 2) The viral posts themselves. Service-role writes only (0039 pattern).
create table if not exists public.viral_app_posts (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('tiktok','instagram')),
  post_id text,
  post_url text not null unique,
  author_handle text,
  -- classified (or inherited from the watchlist row)
  app_name text,
  app_category text,
  by_brand boolean,
  source text not null check (source in ('watchlist','hashtag','search')),
  source_detail text,
  posted_at timestamptz,
  -- engagement (refreshed on re-scrape)
  view_count bigint not null default 0,
  like_count bigint not null default 0,
  comment_count bigint not null default 0,
  share_count bigint not null default 0,
  -- content + AI enrichment
  caption text,
  thumbnail_url text,          -- re-hosted to dreamme-admin-internal-images
  hook_text text,              -- on-screen overlay text (from the cover frame)
  format text,                 -- talking_head | screen_recording | meme | skit | text_overlay | slideshow | other
  hook_type text,              -- question | confession | stat | demo | pov | story | other
  why_it_hit text,
  is_confirmed_app boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_scraped_at timestamptz not null default now()
);

create index if not exists viral_app_posts_views_idx
  on public.viral_app_posts (view_count desc);
create index if not exists viral_app_posts_app_idx
  on public.viral_app_posts (app_name, view_count desc);
create index if not exists viral_app_posts_posted_idx
  on public.viral_app_posts (posted_at desc);

alter table public.viral_app_posts enable row level security;
drop policy if exists "viral_app_posts_anon_read" on public.viral_app_posts;
create policy "viral_app_posts_anon_read" on public.viral_app_posts
  for select using (true);

-- 3) Favorites (UI phase).
create table if not exists public.viral_app_favorites (
  post_id uuid primary key references public.viral_app_posts(id) on delete cascade,
  notes text,
  saved_at timestamptz not null default now()
);

alter table public.viral_app_favorites enable row level security;
drop policy if exists "viral_app_favorites_anon_read" on public.viral_app_favorites;
drop policy if exists "viral_app_favorites_anon_write" on public.viral_app_favorites;
create policy "viral_app_favorites_anon_read" on public.viral_app_favorites
  for select using (true);
create policy "viral_app_favorites_anon_write" on public.viral_app_favorites
  for all using (true) with check (true);

-- 4) Seed watchlist — TikTok brand accounts, skewed toward health/tracker
--    apps (closest to DreamMe) plus famous app-marketing accounts. Handles
--    are best-effort: the scraper records last_result_count, so dead or
--    wrong handles surface as repeated zeros and get fixed in the UI.
insert into public.app_watchlist (platform, handle, app_name, category, notes) values
  ('tiktok','myfitnesspal','MyFitnessPal','health_fitness',null),
  ('tiktok','loseitapp','Lose It!','health_fitness',null),
  ('tiktok','noom','Noom','health_fitness',null),
  ('tiktok','ww','WeightWatchers','health_fitness','verify handle'),
  ('tiktok','fastic','Fastic','health_fitness',null),
  ('tiktok','yuka.app','Yuka','health_fitness','verify handle'),
  ('tiktok','macrofactorapp','MacroFactor','health_fitness','verify handle'),
  ('tiktok','flotracker','Flo','health_fitness','verify handle'),
  ('tiktok','finchcare','Finch','wellness',null),
  ('tiktok','headspace','Headspace','wellness',null),
  ('tiktok','calm','Calm','wellness',null),
  ('tiktok','waterllama','WaterLlama','health_fitness','verify handle'),
  ('tiktok','strava','Strava','fitness',null),
  ('tiktok','whoop','WHOOP','fitness',null),
  ('tiktok','ouraring','Oura','fitness',null),
  ('tiktok','shotsyapp','Shotsy','glp1','GLP-1 tracker competitor; verify handle'),
  ('tiktok','cal.ai','Cal AI','health_fitness','AI calorie scanner; verify handle'),
  ('tiktok','notion','Notion','productivity',null),
  ('tiktok','clickup','ClickUp','productivity',null),
  ('tiktok','canva','Canva','design',null),
  ('tiktok','grammarly','Grammarly','productivity',null),
  ('tiktok','duolingo','Duolingo','education',null),
  ('tiktok','shopify','Shopify','saas',null),
  ('tiktok','mondaydotcom','monday.com','saas','verify handle'),
  ('tiktok','locketcamera','Locket','social',null),
  ('tiktok','bereal','BeReal','social','verify handle'),
  ('tiktok','partiful','Partiful','social',null),
  ('tiktok','rocketmoney','Rocket Money','finance',null),
  ('tiktok','cashapp','Cash App','finance',null),
  ('tiktok','chime','Chime','finance',null),
  ('tiktok','ynab','YNAB','finance',null),
  ('tiktok','copilotmoney','Copilot Money','finance','verify handle'),
  ('tiktok','meetcleo','Cleo','finance',null),
  ('tiktok','umax.app','Umax','consumer','verify handle')
on conflict (platform, handle) do nothing;
