-- Viral App Inspo settings — a single-row table for pipeline toggles the
-- dashboard flips (no code deploy). Anon read+write, same as app_watchlist
-- (the dash sits behind the shared-password gate).
--
-- discovery_enabled: when false, the Tue/Fri scrape only crawls the
-- watchlist accounts and skips the hashtag/keyword "sweep" that hunts for
-- new viral apps beyond the list (cheaper, less noise).

create table if not exists public.viral_app_settings (
  id boolean primary key default true,   -- singleton: only one row (id = true)
  discovery_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint viral_app_settings_singleton check (id)
);

alter table public.viral_app_settings enable row level security;
drop policy if exists "viral_app_settings_anon_read" on public.viral_app_settings;
drop policy if exists "viral_app_settings_anon_write" on public.viral_app_settings;
create policy "viral_app_settings_anon_read" on public.viral_app_settings
  for select using (true);
create policy "viral_app_settings_anon_write" on public.viral_app_settings
  for all using (true) with check (true);

insert into public.viral_app_settings (id, discovery_enabled) values (true, true)
on conflict (id) do nothing;
