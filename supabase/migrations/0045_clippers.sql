-- Clipper rev-share program: public tokenized dashboards per clipper,
-- Facebook view tracking, and RevenueCat webhook-based revenue attribution.
-- Deal: clipper earns revshare_pct (default 20%) of net-of-Apple proceeds on
-- initial + renewal payments, capped 12 months per subscriber, payable 30 days
-- after each transaction if not refunded.
--
-- All five tables are SERVICE-ROLE ONLY (no anon policies): the public
-- /clip/[token] page and all API routes read/write server-side, and
-- clippers.token must never be anon-readable.

-- 1) Clippers roster. code = the in-app creator code (stored UPPER);
--    token = unguessable public-link slug.
create table if not exists public.clippers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  facebook_page_url text,
  revshare_pct numeric not null default 20,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.clippers enable row level security;

-- 2) Their videos. Discovered by the daily page scrape (source='scraped')
--    or added manually by admin/clipper. manual_views is the fallback when
--    the scraper can't read a URL.
create table if not exists public.clipper_videos (
  id uuid primary key default gen_random_uuid(),
  clipper_id uuid not null references public.clippers(id) on delete cascade,
  url text not null unique,
  external_id text,
  platform text not null default 'facebook',  -- facebook | tiktok | instagram
  title text,
  posted_at timestamptz,
  views bigint,                               -- latest scraped
  views_updated_at timestamptz,
  manual_views bigint,                        -- admin override / scrape fallback
  scrape_status text,                         -- ok | <error string>
  source text not null default 'scraped',    -- scraped | admin | clipper
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists clipper_videos_clipper_external_idx
  on public.clipper_videos (clipper_id, external_id)
  where external_id is not null;

alter table public.clipper_videos enable row level security;

-- 3) Daily view snapshots (deltas / sparklines).
create table if not exists public.clipper_video_views (
  video_id uuid not null references public.clipper_videos(id) on delete cascade,
  date date not null,
  views bigint not null,
  primary key (video_id, date)
);

alter table public.clipper_video_views enable row level security;

-- 4) RevenueCat webhook events (all subscription-lifecycle events, attributed
--    or not — unattributed rows enable retroactive repair). id = RC event id,
--    so re-delivered webhooks upsert idempotently. Raw payload preserved.
create table if not exists public.rc_events (
  id text primary key,
  type text not null,
  event_at timestamptz not null,
  store text,
  environment text,
  app_user_id text,
  original_app_user_id text,
  product_id text,
  period_type text,
  transaction_id text,
  original_transaction_id text,
  offer_code text,
  creator_code text,                          -- from subscriber_attributes
  clipper_id uuid references public.clippers(id) on delete set null,
  price_usd numeric,
  price_in_purchased_currency numeric,
  currency text,
  tax_percentage numeric,
  commission_percentage numeric,
  cancel_reason text,
  expiration_at timestamptz,
  raw jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists rc_events_orig_txn_idx
  on public.rc_events (original_transaction_id);
create index if not exists rc_events_clipper_idx
  on public.rc_events (clipper_id, event_at desc);

alter table public.rc_events enable row level security;

-- 5) Recorded payouts (admin-entered; balance = payable - paid).
create table if not exists public.clipper_payouts (
  id uuid primary key default gen_random_uuid(),
  clipper_id uuid not null references public.clippers(id) on delete cascade,
  amount_usd numeric not null,
  paid_at date not null default current_date,
  method text,
  note text,
  created_at timestamptz not null default now()
);

alter table public.clipper_payouts enable row level security;
