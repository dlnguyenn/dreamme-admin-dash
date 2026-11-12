-- App Analytics tab: dated snapshots of the product-analytics report (how
-- people use the app, what keeps them paying, why they cancel, and how far the
-- tracking can be trusted). Each row is one whole report as JSON, shaped by
-- src/lib/app-analytics.ts and checked by src/lib/app-analytics-schema.ts.
--
-- The figures live here and never in this repo, which is public. A session
-- adds a row with POST /api/app-analytics; the tab shows the newest one and
-- lets an older one be picked. Service-role only: /api/app-analytics.

create table if not exists public.app_analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  as_of date not null,
  title text not null default '',
  payload jsonb not null,
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists app_analytics_snapshots_as_of_idx
  on public.app_analytics_snapshots (as_of desc, created_at desc);

comment on table public.app_analytics_snapshots is
  'DAD App Analytics tab: one row per dated product-analytics report (JSON). Service-role only.';

alter table public.app_analytics_snapshots enable row level security;
revoke all on public.app_analytics_snapshots from anon, authenticated;
