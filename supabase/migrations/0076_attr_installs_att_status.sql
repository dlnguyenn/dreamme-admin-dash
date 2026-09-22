-- WHY (2026-09-22): the app attribution SDK will report the device's ATT
-- decision alongside the install ping so match quality and CAPI eligibility
-- can be segmented by consent. Nullable text: granted | denied | undetermined.
-- Applied via MCP on 2026-09-22.
alter table public.attr_installs add column if not exists att_status text;
comment on column public.attr_installs.att_status is
  'iOS App Tracking Transparency status at first open: granted | denied | undetermined. Null on Android and on pings from SDK builds that predate the field.';
