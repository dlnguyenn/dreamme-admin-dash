-- Growth AI v2: AI creative tags, recap history, and the confirm-gated
-- action audit log. All three tables are written exclusively through the
-- service role (server routes/crons); the dashboard reads them with the
-- anon key — so anon gets SELECT only, no write policies.

-- 1) Motion-style AI tags per ad creative. Populated by /api/growth/tag
--    (and the daily growth-tag cron); source_hash detects creative changes
--    so unchanged ads are never re-billed.
create table if not exists public.ad_creative_tags (
  ad_id text primary key,
  creative_id text,
  visual_format text not null check (visual_format in (
    'ugc_talking_head','screen_recording','greenscreen','post_it',
    'letter_text','montage','testimonial','comment_response',
    'static_illustration','static_photo','meme','other')),
  messaging_theme text not null,
  theme_description text,
  audience text,
  hook_type text,
  confidence numeric,
  model text not null,
  source_hash text not null,
  tagged_at timestamptz not null default now()
);

create index if not exists ad_creative_tags_theme_idx
  on public.ad_creative_tags (messaging_theme);

alter table public.ad_creative_tags enable row level security;

drop policy if exists "ad_creative_tags_anon_read" on public.ad_creative_tags;
create policy "ad_creative_tags_anon_read" on public.ad_creative_tags
  for select using (true);

-- 2) Weekly recap history. Written by /api/growth/recap (manual) and
--    /api/cron/growth-recap (Monday cron). sent_at records email delivery.
create table if not exists public.growth_recaps (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  generated_at timestamptz not null default now(),
  model text not null,
  stats jsonb not null,
  recap jsonb not null,
  source text not null default 'manual' check (source in ('manual','cron')),
  sent_at timestamptz
);

create index if not exists growth_recaps_week_idx
  on public.growth_recaps (week_start desc, generated_at desc);

alter table public.growth_recaps enable row level security;

drop policy if exists "growth_recaps_anon_read" on public.growth_recaps;
create policy "growth_recaps_anon_read" on public.growth_recaps
  for select using (true);

-- 3) Append-only audit trail for AI-proposed Meta actions the user
--    confirmed in the dashboard (or fired from the ad drawer). One row per
--    attempt, success or failure — never updated, never deleted.
create table if not exists public.growth_action_log (
  id uuid primary key default gen_random_uuid(),
  requested_at timestamptz not null default now(),
  kind text not null check (kind in (
    'pause_ad','activate_ad','set_adset_budget','set_campaign_budget','duplicate_adset')),
  target_id text not null,
  target_name text,
  params jsonb not null default '{}'::jsonb,
  reason text,
  source text not null default 'analyst_chat',
  status text not null check (status in ('applied','failed')),
  result jsonb,
  error text
);

alter table public.growth_action_log enable row level security;

drop policy if exists "growth_action_log_anon_read" on public.growth_action_log;
create policy "growth_action_log_anon_read" on public.growth_action_log
  for select using (true);
