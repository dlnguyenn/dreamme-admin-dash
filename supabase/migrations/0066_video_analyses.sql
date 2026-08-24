-- Video storyboard cache for Outlier: one row per analyzed video (inspo post
-- or competitor ad), written once by the Gemini analysis pass and read
-- forever after. Same RLS convention as 0044/0050: anon reads, writes
-- service-role only.

create table if not exists public.video_analyses (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('inspo', 'competitor')),
  source_id uuid not null,
  model text not null,
  duration_s numeric,
  hook_summary text,
  beats jsonb not null default '[]'::jsonb,
  style text,
  why_it_works text,
  seedance_prompt text not null default '',
  overlay_plan jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_kind, source_id)
);

alter table public.video_analyses enable row level security;

drop policy if exists "video_analyses_read" on public.video_analyses;
create policy "video_analyses_read" on public.video_analyses
  for select using (true);
