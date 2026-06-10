-- Avatar reference images for the Image Studio. Ten named slots, each
-- holding at most one reference image. The admin uploads or replaces
-- the photo per slot via PUT /api/avatars/[name]; the dashboard's
-- Image Studio panel highlights one to use as the reference for both
-- Generate and Submit-as-Batch flows. Distinct from the personas in
-- src/lib/personas.ts (only "diane" overlaps in name).
--
-- Image bytes live in the existing public bucket
-- `dreamme-admin-internal-images` (created in 0001_init.sql) under
-- the `avatars/` prefix. Path includes a short random suffix so
-- replacing an avatar mints a new public URL and dodges CDN cache.

create table if not exists public.avatars (
  name text primary key,
  image_url text,
  updated_at timestamptz not null default now()
);

alter table public.avatars enable row level security;

drop policy if exists "avatars_anon_read" on public.avatars;
drop policy if exists "avatars_anon_write" on public.avatars;

create policy "avatars_anon_read"
  on public.avatars for select using (true);
create policy "avatars_anon_write"
  on public.avatars for all using (true) with check (true);

insert into public.avatars (name) values
  ('alex'),
  ('ava'),
  ('diane'),
  ('hailey'),
  ('jessica'),
  ('max'),
  ('maya'),
  ('rachel'),
  ('sarah'),
  ('taylor')
on conflict (name) do nothing;
