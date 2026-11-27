-- Daily App Store rating count per territory, so "did ratings spike on day X?"
-- has an answer. Apple only exposes a running total (public lookup API), so we
-- keep one snapshot a day, taken by the 11:30 UTC store-reviews cron
-- (src/lib/rating-snapshots.ts). Ratings per day = the difference between days.
--
-- source: 'lookup' = taken by the cron (cache-busted request);
--         'vault'  = a past count copied from the team vault (time of day
--                    unknown and possibly up to a day stale; Apple's lookup
--                    is cached by Akamai for 24 h). Lower confidence.
create table if not exists public.app_store_rating_snapshots (
  day date not null,
  territory text not null,              -- lookup country code: us, ca, gb, au
  source text not null default 'lookup' check (source in ('lookup','vault')),
  rating_count integer not null check (rating_count >= 0),
  average_rating numeric(4,3),
  app_version text,
  fetched_at timestamptz not null default now(),
  primary key (day, territory, source)
);

comment on table public.app_store_rating_snapshots is
  'One App Store rating-count snapshot per day and territory (iTunes lookup). Service-role only.';

alter table public.app_store_rating_snapshots enable row level security;
revoke all on public.app_store_rating_snapshots from anon, authenticated;

-- US counts recorded in the vault before this table existed (wiki/aso.md,
-- wiki/meagain-revenue-bridge.md, wiki/trial-email-test.md).
insert into public.app_store_rating_snapshots (day, territory, source, rating_count, average_rating) values
  ('2026-11-04', 'us', 'vault', 3297, null),
  ('2026-11-09', 'us', 'vault', 3368, null),
  ('2026-11-11', 'us', 'vault', 3407, null),
  ('2026-11-13', 'us', 'vault', 3420, 4.700),
  ('2026-11-16', 'us', 'vault', 3514, 4.706)
on conflict do nothing;
