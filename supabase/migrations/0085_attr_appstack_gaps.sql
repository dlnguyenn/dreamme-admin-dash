-- WHY (2026-10-05): close the gaps a read-only Appstack teardown found in the
-- first-party EAC loop (outlier branch feat/attr-appstack-gaps).
--
-- attr_clicks: the /l ad link now mints/keeps a first-party _fbp cookie and
-- logs it (Appstack sends fbc AND fbp; fbp is their main Event Match Quality
-- lever), plus two more Meta URL macros their ad link carries:
-- pl={{placement}}, ss={{site_source_name}}. outlier's insertClick retries
-- without these columns if this migration is not applied yet, so order of
-- deploy vs migration cannot lose clicks.
--
-- attr_capi_log:
--   * new event names: Lead (every matched install, event_id = install_id;
--     Meta has no Install standard event, so Appstack maps installs to Lead)
--     and Meta's standard StartTrial / Subscribe, used only when the cron
--     targets a dedicated attributed-only dataset (META_ATTR_DATASET_ID).
--   * dataset_id joins the key, so moving to a new dataset re-sends recent
--     events there instead of treating them as already done. Existing rows
--     all went to the shared dataset 1777837186267557.
--
-- Deploy note: until outlier ships, the old cron upserts with
-- on_conflict=event_name,event_id, which no longer matches a unique key and
-- fails AFTER the CAPI send. Meta dedupes on event_name + event_id, so the
-- resend on the next tick is harmless; apply this right before the deploy.

alter table public.attr_clicks
  add column if not exists fbp text,              -- Meta browser id: fb.<idx>.<ms>.<rand>
  add column if not exists placement text,        -- {{placement}}
  add column if not exists site_source_name text; -- {{site_source_name}} (fb / ig / an / msg)

alter table public.attr_capi_log
  add column if not exists dataset_id text not null default '1777837186267557';

alter table public.attr_capi_log drop constraint if exists attr_capi_log_event_name_check;
alter table public.attr_capi_log add constraint attr_capi_log_event_name_check
  check (event_name in ('attr_start_trial','attr_subscribe','Lead','StartTrial','Subscribe'));

alter table public.attr_capi_log drop constraint if exists attr_capi_log_pkey;
alter table public.attr_capi_log add constraint attr_capi_log_pkey
  primary key (dataset_id, event_name, event_id);

comment on table public.attr_capi_log is
  'Dedupe + audit for attributed events forwarded to Meta CAPI by outlier /api/cron/attr-capi: Lead (matched install), trial and first paid start, as website events with click signals. Keyed by (dataset_id, event_name, event_id); event_id = install_id for Lead, original_transaction_id otherwise.';
