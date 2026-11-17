-- Apple Ads (ASA) and App Store listing (ASO) tabs.
--
-- Both tabs read only from these tables; the daily crons fill them:
--   /api/cron/sync-asa   (src/lib/asa/sync.ts)  Apple Ads Campaign Management API v5
--   /api/cron/sync-aso   (src/lib/aso/asc-analytics.ts)  App Store Connect analytics
--   /api/cron/aso-ranks  (src/lib/aso/ranks.ts)  public iTunes Search API
--
-- This repo is public, so the keyword lists, rank terms and test settings are
-- seeded as rows, never written into code. Every table is service-role only.

-- ── Apple Ads ───────────────────────────────────────────────────────────

create table if not exists public.asa_campaigns (
  campaign_id bigint primary key,
  name text not null,
  status text,                 -- ENABLED / PAUSED (the on/off switch)
  serving_status text,         -- RUNNING / NOT_RUNNING
  display_status text,
  serving_reasons jsonb not null default '[]'::jsonb,
  daily_budget numeric(12,2),
  currency text,
  start_time timestamptz,
  end_time timestamptz,        -- null = runs with no stop date
  countries text[] not null default '{}',
  deleted boolean not null default false,
  synced_at timestamptz not null default now()
);

create table if not exists public.asa_ad_groups (
  ad_group_id bigint primary key,
  campaign_id bigint not null,
  name text not null,
  status text,
  serving_status text,
  serving_reasons jsonb not null default '[]'::jsonb,
  default_bid numeric(12,2),
  search_match boolean,
  start_time timestamptz,
  end_time timestamptz,
  deleted boolean not null default false,
  synced_at timestamptz not null default now()
);

-- One row per campaign per day (Apple's own campaign report, so it includes
-- Search Match and anything not tied to a keyword).
create table if not exists public.asa_campaign_daily (
  day date not null,
  campaign_id bigint not null,
  impressions integer not null default 0,
  taps integer not null default 0,
  tap_installs integer not null default 0,
  view_installs integer not null default 0,
  tap_new_downloads integer not null default 0,
  spend numeric(12,4) not null default 0,
  synced_at timestamptz not null default now(),
  primary key (day, campaign_id)
);

create table if not exists public.asa_keyword_daily (
  day date not null,
  keyword_id bigint not null,
  campaign_id bigint not null,
  ad_group_id bigint not null,
  keyword text not null,
  match_type text,
  keyword_status text,
  bid numeric(12,2),
  impressions integer not null default 0,
  taps integer not null default 0,
  tap_installs integer not null default 0,
  view_installs integer not null default 0,
  tap_new_downloads integer not null default 0,
  spend numeric(12,4) not null default 0,
  synced_at timestamptz not null default now(),
  primary key (day, keyword_id)
);

-- The keyword list as it is now (status, bid), including keywords that have
-- never served, which the daily report leaves out.
create table if not exists public.asa_keywords (
  keyword_id bigint primary key,
  campaign_id bigint not null,
  ad_group_id bigint not null,
  keyword text not null,
  match_type text,
  status text,
  bid numeric(12,2),
  deleted boolean not null default false,
  synced_at timestamptz not null default now()
);

create table if not exists public.asa_negative_keywords (
  negative_id bigint primary key,
  campaign_id bigint not null,
  ad_group_id bigint,           -- null = campaign-level negative
  text text not null,
  match_type text,
  status text,
  synced_at timestamptz not null default now()
);

-- Search terms over a rolling 30-day window, replaced on every sync.
-- search_term is null when Apple hides it (low volume / privacy).
create table if not exists public.asa_search_terms (
  id bigserial primary key,
  window_start date not null,
  window_end date not null,
  campaign_id bigint not null,
  ad_group_id bigint,
  keyword_id bigint,
  keyword text,
  search_term text,
  source text,                  -- TARGETED / AUTO (Search Match)
  impressions integer not null default 0,
  taps integer not null default 0,
  tap_installs integer not null default 0,
  spend numeric(12,4) not null default 0,
  synced_at timestamptz not null default now()
);
create index if not exists asa_search_terms_campaign_idx on public.asa_search_terms (campaign_id);

-- A time-boxed Apple Ads test and its read rules (the tab draws the
-- checkpoints and the keep/stop verdict from this row).
create table if not exists public.asa_tests (
  campaign_id bigint primary key,
  label text not null,
  keep_cost_per_trial numeric(10,2) not null,
  stop_cost_per_trial numeric(10,2) not null,
  length_days integer not null default 14,
  checkpoints integer[] not null default '{3,7,14}',
  started_on date,              -- set when it is unpaused
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- RevenueCat events the Apple Ads integration attributed (the app collects
-- Apple's AdServices token from iOS 1.5.8; RevenueCat then sets these
-- subscriber attributes). $campaign / $adGroup / $keyword hold Apple's ids or
-- names, depending on the integration, so the tab matches either.
create or replace view public.asa_rc_events
with (security_invoker = true) as
select
  e.id,
  e.type,
  e.period_type,
  e.event_at,
  e.app_user_id,
  e.product_id,
  e.price_usd,
  e.raw->'event'->'subscriber_attributes'->'$campaign'->>'value' as asa_campaign,
  e.raw->'event'->'subscriber_attributes'->'$adGroup'->>'value'  as asa_ad_group,
  e.raw->'event'->'subscriber_attributes'->'$keyword'->>'value'  as asa_keyword
from public.rc_events e
where e.raw->'event'->'subscriber_attributes'->'$mediaSource'->>'value' = 'Apple Search Ads'
  and coalesce(e.environment, 'PRODUCTION') = 'PRODUCTION';

revoke all on public.asa_rc_events from anon, authenticated;

-- ── App Store listing ───────────────────────────────────────────────────

-- App Store Connect analytics, one row per day, territory and source.
-- territory: 'US' or 'ALL' (every territory summed). Apple keeps only ~35
-- days of daily report instances, so this table is the long history.
create table if not exists public.aso_store_daily (
  day date not null,
  territory text not null check (territory in ('US','ALL')),
  source_type text not null,    -- App Store search, App referrer, App Store browse, Web referrer, ...
  impressions integer not null default 0,
  impressions_unique integer not null default 0,
  page_views integer not null default 0,
  page_views_unique integer not null default 0,
  first_downloads integer not null default 0,
  redownloads integer not null default 0,
  instance_date date,           -- the report instance the row came from (latest wins)
  synced_at timestamptz not null default now(),
  primary key (day, territory, source_type)
);

-- Which searches to track, and where each term's result is credited.
create table if not exists public.aso_rank_terms (
  term text not null,
  country text not null default 'us',
  term_sets text[] not null,    -- any of: core, locale-test, br (a term can sit in several)
  locale_tag text,              -- the hidden locale that targets it (locale-test terms)
  position integer not null default 0,
  active boolean not null default true,
  primary key (term, country)
);

-- One rank check per day, term and country. Ranks are the iTunes Search API
-- order, a proxy for live search (no ad slot, no personalization).
create table if not exists public.aso_rank_checks (
  day date not null,
  term text not null,
  country text not null,
  dreamme integer,              -- null = not in the results Apple returned
  meagain integer,
  shotsy integer,
  results_n integer,
  top5 jsonb not null default '[]'::jsonb,
  source text not null default 'cron' check (source in ('cron','vault')),
  checked_at timestamptz not null default now(),
  primary key (day, term, country)
);

-- Dated events drawn on the ASO charts (releases, listing changes, tests).
create table if not exists public.aso_markers (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  label text not null,
  kind text not null default 'release' check (kind in ('release','listing','test','other')),
  created_at timestamptz not null default now()
);

do $rls$
declare t text;
begin
  foreach t in array array[
    'asa_campaigns','asa_ad_groups','asa_campaign_daily','asa_keyword_daily','asa_keywords',
    'asa_negative_keywords','asa_search_terms','asa_tests',
    'aso_store_daily','aso_rank_terms','aso_rank_checks','aso_markers'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $rls$;

revoke all on sequence public.asa_search_terms_id_seq from anon, authenticated;
