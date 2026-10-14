-- WHY (2026-10-14): Appstack SDK teardown, steps 1+2 (outlier). Their
-- install<->click match is gated on a device fingerprint both sides can
-- see; ours compared IP + time only. The click side now records what the
-- in-app browser UA names (Facebook FBDV/FBSV/FBSS/FBLC, Instagram's
-- "(model; iOS x_y_z; locale; ..; scale=; WxH)") and what the /l page
-- beacons back before redirecting (screen points, dpr, language, Intl
-- timezone, WebKit build; POST /l/b). The matcher then rejects same-IP
-- clicks whose device conflicts, and accepts same-/24 or /64 clicks whose
-- device agrees (match_method 'network'; CAPI keeps that tier out of Meta
-- until measured). outlier's insertClick retries without these columns
-- (PGRST204) when this is not applied yet, so deploy order cannot lose
-- clicks; the matcher falls back to parsing the UA on read.
--
-- screen_w/screen_h are CSS POINTS (the same unit attr_installs uses).

alter table public.attr_clicks
  add column if not exists model text,            -- iPhone17,4 (UA)
  add column if not exists os_version text,       -- 26.6.1 (UA, normalised)
  add column if not exists screen_scale numeric,  -- 3 (UA FBSS / IG scale, or beacon dpr)
  add column if not exists screen_w integer,      -- points (IG px / scale, or beacon)
  add column if not exists screen_h integer,
  add column if not exists timezone text,         -- beacon only (no UA carries it)
  add column if not exists lang text,             -- UA FBLC / IG locale, or beacon
  add column if not exists webkit text,           -- beacon: AppleWebKit/<build>
  add column if not exists beacon_at timestamptz; -- first beacon wins

-- The matcher now reads an IP RANGE (same /24 or /64) per install.
create index if not exists attr_clicks_ip_clicked_at_idx
  on public.attr_clicks (ip, clicked_at desc);
