-- WHY (2026-08-28): first-party attribution, phase 1 — the install registry.
-- The DreamMe app's new attribution SDK (feat/attribution-sdk in the iOS
-- repo) POSTs one ping per install to outlier's /api/attr/install with a
-- client-generated install_id and full device signals (Dan chose the full
-- posture: model/OS/locale/timezone/screen/IDFV client-side, IP+UA observed
-- server-side). Later phases match these rows to ad-link clicks and join
-- revenue via rc_events.app_user_id — Appstack's EAC loop, built in-house.
--
-- Conventions: store-raw-plus-extract (the skan_postbacks pattern);
-- service-role only (RLS enabled, NO policies — same as rc_events);
-- primary key on install_id so SDK retries and later app_user_id linking
-- are plain upserts.

create table if not exists public.attr_installs (
  install_id uuid primary key,
  first_open_at timestamptz not null,
  app_user_id text,               -- RevenueCat app_user_id (Supabase auth id); null until auth links
  platform text,                  -- ios | android
  os_version text,
  device_model text,
  locale text,
  timezone text,
  screen_w integer,
  screen_h integer,
  screen_scale numeric,
  idfv text,                      -- iOS identifierForVendor (same-vendor scope, no ATT needed)
  app_version text,
  launch_url text,                -- cold-start deep link, if any
  fbclid text,                    -- extracted from launch/deferred link — phase-3 CAPI click matching
  deferred_link text,             -- Meta deferred app link, when metaAttribution had one cached
  ip inet,                        -- server-observed (x-forwarded-for first hop), never client-supplied
  ua text,                        -- server-observed User-Agent
  raw jsonb not null default '{}'::jsonb,
  matched_click_id uuid,          -- phase-2 matcher output
  match_method text,
  match_confidence text,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attr_installs_app_user_idx on public.attr_installs (app_user_id);
create index if not exists attr_installs_first_open_idx on public.attr_installs (first_open_at desc);

comment on table public.attr_installs is
  'First-party install registry fed by the DreamMe app attribution SDK via outlier /api/attr/install. One row per install; upserted on retries and auth-linking.';
comment on column public.attr_installs.fbclid is
  'Click id seen at first open (cold-start URL or deferred link) — upgrades CAPI user_data from hashed-email-only to click matching in phase 3.';

alter table public.attr_installs enable row level security;
-- service-role only: no policies on purpose (rc_events convention).
