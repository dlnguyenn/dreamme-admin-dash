-- Ad breakdowns: one row per analyzed video ad, either a live Meta ad
-- (source_kind 'meta_ad', keyed by ad id) or an uploaded pre-flight cut
-- (source_kind 'upload', keyed by its Storage path). Written by the
-- /api/ad-breakdown pipeline in the admin dash and Outlier (service role),
-- read by both UIs. Same RLS convention as 0066_video_analyses: anon reads,
-- writes service-role only.

create table if not exists public.ad_breakdowns (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('meta_ad', 'upload')),
  source_key text not null,
  ad_id text,
  name text,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  error text,
  video_url text,
  video_bytes integer,
  duration_s numeric,
  days integer,
  -- creative / adset / campaign snapshot (AdDetails)
  ad jsonb,
  -- 14-day insights snapshot incl. the nine retention points (AdMetrics)
  metrics jsonb,
  -- {curve, intervals} with spoken / scenes / frames evidence per interval
  retention jsonb,
  -- Gemini listen pass: scenes, transcript segments, music, claims
  listen jsonb,
  -- Gemini rubric pass, raw yes/no anchors per criterion
  preflight jsonb,
  -- derived: criterion scores, pacing, formula /27, rule bands vs Gemini's
  scores jsonb,
  -- which seconds the UI captures frames at (hook / scene / @milestone / mid)
  frames jsonb,
  -- Claude's written verdict (markdown)
  verdict text,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_kind, source_key)
);

create index if not exists ad_breakdowns_ad_id_idx on public.ad_breakdowns (ad_id);
create index if not exists ad_breakdowns_kind_created_idx on public.ad_breakdowns (source_kind, created_at desc);

alter table public.ad_breakdowns enable row level security;

drop policy if exists "ad_breakdowns_read" on public.ad_breakdowns;
create policy "ad_breakdowns_read" on public.ad_breakdowns
  for select using (true);
