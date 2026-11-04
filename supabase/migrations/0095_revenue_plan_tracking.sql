-- 0095: tracking for the April-2027 revenue plan (vault: wiki/revenue-100k-question.md).
-- Both tables are SERVICE-ROLE ONLY (RLS on, no policies): they are read and
-- written through /api/plan/* and the sync cron, never by the anon key.

-- 1) user_sources: nightly copy of the consumer app's users.referral_source
--    ("how did you hear about us?") and onboarding_completed_at, so rc_events
--    can join on app_user_id inside this project. user_id = consumer users.id
--    = the RevenueCat app_user_id. Written by /api/cron/sync-user-sources.
create table if not exists public.user_sources (
  user_id text primary key,
  referral_source text,
  onboarding_completed_at timestamptz,
  synced_at timestamptz not null default now()
);

create index if not exists user_sources_onboarded_idx
  on public.user_sources (onboarding_completed_at);

alter table public.user_sources enable row level security;

-- 2) clipper_campaign_weeks: hand-entered weekly spend for the pay-per-view
--    clipper campaign (Content Rewards / Whop has no API). week_start is a
--    Monday (US/Eastern weeks, matching the tracker). clipper_id null = the
--    whole campaign; a clipper id = one creator's row (per-creator tracking).
create table if not exists public.clipper_campaign_weeks (
  id uuid primary key default gen_random_uuid(),
  week_start date not null check (extract(isodow from week_start) = 1),
  clipper_id uuid references public.clippers(id) on delete cascade,
  views_bought bigint check (views_bought is null or views_bought >= 0),
  payouts_usd numeric not null default 0 check (payouts_usd >= 0),
  fees_usd numeric not null default 0 check (fees_usd >= 0),
  tranche text,
  note text,
  updated_at timestamptz not null default now()
);

-- One row per week per scope. NULLS NOT DISTINCT so the campaign row
-- (clipper_id null) dedupes too and PostgREST on_conflict can target the
-- plain column list (same pattern as marketing_alerts_dedupe).
create unique index if not exists clipper_campaign_weeks_week_scope
  on public.clipper_campaign_weeks (week_start, clipper_id)
  nulls not distinct;

alter table public.clipper_campaign_weeks enable row level security;

-- 3) The panels page through rc_events by type and event_at (trial starts and
--    charges since a date). Without this every page is a full scan of ~60 MB
--    of raw webhook payloads, and parallel pages hit the 8 s statement timeout.
create index if not exists rc_events_type_event_at_idx
  on public.rc_events (type, event_at);
