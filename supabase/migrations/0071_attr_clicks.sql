-- WHY (2026-08-28): first-party attribution phase 2 — the click side.
-- The tracking link (outlier /l, to be served as go.dreamme.life) 302s ad
-- taps straight to the store and logs one row here via Next's after() hook
-- (zero latency added before the redirect). One canonical link serves every
-- ad: Meta URL macros ({{campaign.id}}, {{ad.id}}, ...) carry identity, so
-- there is no per-ad link management. The matcher joins these to
-- attr_installs (0070) on ip + ua platform + recency, writing
-- matched_click_id/-method/-confidence there.
--
-- Service-role only (RLS enabled, no policies), raw-plus-extract, same as
-- 0070/rc_events.

create table if not exists public.attr_clicks (
  click_id uuid primary key default gen_random_uuid(),
  clicked_at timestamptz not null default now(),
  ip inet,
  ua text,
  platform_hint text,             -- ios | android | other (from click UA)
  media_source text,              -- 'meta' etc. (src param)
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  fbclid text,                    -- Meta auto-appends; phase-3 CAPI gold
  creator_code text,              -- future creator rev-share links
  landing text,                   -- app_store | play_store
  raw jsonb not null default '{}'::jsonb
);

create index if not exists attr_clicks_ip_time_idx on public.attr_clicks (ip, clicked_at desc);
create index if not exists attr_clicks_ad_idx on public.attr_clicks (ad_id, clicked_at desc);

comment on table public.attr_clicks is
  'Ad-link clicks from the go.dreamme.life redirect (outlier /l). One canonical link serves all ads - Meta URL macros carry campaign/adset/ad identity. Matched to attr_installs by ip+ua+recency.';

alter table public.attr_clicks enable row level security;
-- service-role only: no policies on purpose.
