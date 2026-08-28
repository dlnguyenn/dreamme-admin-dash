-- Trial-count diagnostics for ad_insights_daily.
--
-- trial_starts currently counts app_custom_event.fb_mobile_complete_registration
-- (the registration proxy picked 2026-05-01). To validate it — and switch to a
-- real trial event if one now exists (e.g. via RevenueCat's Meta integration) —
-- the sync now also persists:
--   strict_trial_starts  sum of Meta's standard start-trial action types
--   raw_actions          the full per-day actions array, for action-type audits
--
-- Both are additive and nullable; nothing downstream reads them yet.

alter table ad_insights_daily
  add column if not exists strict_trial_starts integer,
  add column if not exists raw_actions jsonb;

comment on column ad_insights_daily.strict_trial_starts is
  'Sum of Meta standard start-trial actions (start_trial_total, start_trial_mobile_app, start_trial_website, app_custom_event.fb_mobile_start_trial). Null before the 0074 sync deploy; 0 when Meta reports none.';
comment on column ad_insights_daily.raw_actions is
  'Verbatim Meta insights actions array for this ad-day. For auditing which conversion events actually fire (e.g. picking the right trial event).';
