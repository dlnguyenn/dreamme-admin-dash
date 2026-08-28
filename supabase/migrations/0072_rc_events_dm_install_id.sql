-- WHY (2026-08-28): attribution phase 3b — join revenue to installs.
-- The app's attribution SDK mirrors its install id into RevenueCat
-- subscriber attributes (dm_install_id); the rc-webhook now extracts it the
-- same way creator_code is extracted, so every revenue event carries the
-- install id directly and the Outlier Attribution tab can join
-- rc_events -> attr_installs -> attr_clicks without indirection.

alter table public.rc_events add column if not exists dm_install_id text;
create index if not exists rc_events_dm_install_idx on public.rc_events (dm_install_id) where dm_install_id is not null;
comment on column public.rc_events.dm_install_id is
  'First-party install id from RC subscriber_attributes.dm_install_id (set by the app attribution SDK) - joins revenue to attr_installs.';
