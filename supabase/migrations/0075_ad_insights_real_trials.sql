-- WHY (2026-09-14): trial_starts has been the registration proxy
-- (fb_mobile_complete_registration) since 2026-05-01 because the validation
-- only read Meta's `actions` field. Meta reports the StartTrial / Subscribe
-- STANDARD events in the separate `conversions` field, and it has carried
-- start_trial_total for this account since at least March 2026 — Ads
-- Manager's "In-app start trials" column. Sep 7–13: 372 real trials vs 79
-- registrations, so every cost-per-trial downstream ran ~4x too high.
--
-- From this sync deploy on:
--   trial_starts         = conversions.start_trial_total  (real trials)
--   strict_trial_starts  = same value (audit twin, kept for continuity)
--   registrations        = the old proxy, preserved under its true name
--   subscribes           = conversions.subscribe_total     (paid starts)
--   subscribe_value      = conversion_values.subscribe_total (Meta-reported,
--                          partial — RevenueCat stays the revenue truth)
-- Backfilled 200 days via /api/cron/sync-ad-insights?days=200 right after
-- deploy, so rows before that (pre-Feb 2026) still hold the proxy in
-- trial_starts with registrations = null.

alter table ad_insights_daily
  add column if not exists registrations integer,
  add column if not exists subscribes integer,
  add column if not exists subscribe_value numeric;

comment on column ad_insights_daily.trial_starts is
  'Meta StartTrial standard event (insights conversions.start_trial_total) since the 2026-09-14 sync. Before the 200-day backfill boundary this column holds the registration proxy instead.';
comment on column ad_insights_daily.strict_trial_starts is
  'Audit twin of trial_starts (same source since 2026-09-14). 0/null before then because the sync read the wrong field.';
comment on column ad_insights_daily.registrations is
  'app_custom_event.fb_mobile_complete_registration — the pre-2026-09-14 "trial" proxy. Not a trial.';
comment on column ad_insights_daily.subscribes is
  'Meta Subscribe standard event (conversions.subscribe_total) — trial→paid starts Meta attributed to the ad.';
comment on column ad_insights_daily.subscribe_value is
  'Meta-reported conversion value on Subscribe. Partial; use RevenueCat for revenue.';
