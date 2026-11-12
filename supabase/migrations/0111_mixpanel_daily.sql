-- App Analytics > Daily: one row per Eastern day of Mixpanel activity, filled
-- by /api/cron/sync-mixpanel (src/lib/mixpanel-daily.ts) with a single JQL
-- query a day.
--
--   events  { "<event name>": [users, total, ios_users, ios_total,
--                              android_users, android_total], ... }
--   people  { "act":  [all, ios, android],   -- did something by hand
--             "seen": [all, ios, android] }  -- had a screen up (adds impressions)
--
-- A day is re-pulled for three days after it ends, because phones send late.
-- Service-role only: /api/app-analytics/daily.

create table if not exists public.mixpanel_daily (
  day date primary key,
  events jsonb not null default '{}'::jsonb,
  people jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

comment on table public.mixpanel_daily is
  'DAD App Analytics > Daily: per-Eastern-day Mixpanel event users and totals. Service-role only.';

alter table public.mixpanel_daily enable row level security;
revoke all on public.mixpanel_daily from anon, authenticated;
