-- App Analytics > New people / Coming back: what the per-event counts in
-- `mixpanel_daily` can't hold. One row per Eastern day, filled by
-- /api/cron/sync-mixpanel (src/lib/mixpanel-detail.ts) with two more JQL
-- queries a day.
--
--   breakdowns  { "<event>|<property>": { "<value>": [users, total], ... }, ... }
--               one event split by one of its properties, e.g. onboarding
--               steps by screen name. The key ending "|rank" holds
--               [users, sum of positions] so the screens can be put in the
--               order people meet them.
--   cohorts     what the people who signed up, or started a trial, on this
--               day did afterwards:
--               { "through": "<last complete day when counted>",
--                 "signup": { "n": people, "f": [came back at each wait] },
--                 "trial":  { "n": people, "f": [...],
--                             "h": [people by active days in the first week] } }
--
-- A cohort row keeps changing until its longest wait has passed, so the sync
-- rewrites the last 100 days every morning.
-- Service-role only: /api/app-analytics/daily.

create table if not exists public.mixpanel_daily_detail (
  day date primary key,
  breakdowns jsonb not null default '{}'::jsonb,
  cohorts jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

comment on table public.mixpanel_daily_detail is
  'DAD App Analytics: per-Eastern-day Mixpanel property breakdowns and sign-up/trial cohorts. Service-role only.';

alter table public.mixpanel_daily_detail enable row level security;
revoke all on public.mixpanel_daily_detail from anon, authenticated;
