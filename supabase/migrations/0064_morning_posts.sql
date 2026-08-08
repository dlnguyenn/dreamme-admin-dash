-- Morning routine posts — the FB/IG (and YouTube) posts the daily content
-- routines create on the persona and faceless account sets each morning.
--
-- Rows are written by claude/scripts/publish-morning-posts.py at creation time
-- from a manifest the routine builds as it calls create_post. The routine is
-- the only source that knows the TRUE creation status: the Doublespeed REST
-- API reports draft posts as "scheduled" (verified 2026-08-08), so
-- created_status is recorded here and never inferred from the API. The synced
-- columns are refreshed by src/lib/batchState.ts (syncMorningPostState) and,
-- as in 0057, stay nullable: never-synced must read as UNKNOWN, not as a state
-- we haven't verified.
--
-- Unique key (batch_date, set_key, platform) is the upsert conflict target and
-- exactly the unit the Overview grid renders — re-running a routine overwrites
-- in place rather than duplicating.

create table if not exists public.morning_posts (
  id uuid primary key default gen_random_uuid(),
  batch_date date not null,               -- ET day the routine ran for
  routine text not null,                  -- 'wall-of-text' | 'text-card-decks'
  set_key text not null,                  -- 'hannah' | 'olivia' | 'mikayla' | 'glp1_tips' | ...
  platform text not null,                 -- 'facebook' | 'instagram' | 'youtube'
  username text,                          -- doublespeed account username actually posted to
  doublespeed_post_id text,
  post_kind text not null,                -- 'video' | 'carousel'
  caption text,
  sound text,
  thumb_url text,                         -- Supabase Storage public URL
  video_url text,                         -- public renders URL; null for carousels (renders 400s for slideshows)
  created_status text not null,           -- 'draft' | 'scheduled' at creation, routine-recorded truth
  post_status text,                       -- synced from Doublespeed REST; null = never synced
  posted_at timestamptz,
  public_post_url text,
  state_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (batch_date, set_key, platform)
);

create index if not exists morning_posts_date_idx
  on public.morning_posts (batch_date desc);

-- Sync reads "which rows are stale" on every Overview build.
create index if not exists morning_posts_state_sync_idx
  on public.morning_posts (state_synced_at nulls first);

alter table public.morning_posts enable row level security;
