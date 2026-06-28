-- Pose reference images for the Image Studio. A fixed set of named pose
-- slots, each holding at most one reference image. The admin uploads or
-- replaces the photo per slot via PUT /api/poses/[name]; the Image Studio
-- panel highlights one to use as a POSE reference (sent to Gemini alongside
-- any avatar/uploaded references, plus an auto-appended pose hint in the
-- prompt). Mirrors the `avatars` table (migration 0023).
--
-- Image bytes live in the existing public bucket
-- `dreamme-admin-internal-images` under the `poses/` prefix. Path includes a
-- short random suffix so replacing a pose mints a new public URL and dodges
-- CDN cache.

create table if not exists public.pose_references (
  name text primary key,
  image_url text,
  updated_at timestamptz not null default now()
);

alter table public.pose_references enable row level security;

drop policy if exists "pose_references_anon_read" on public.pose_references;
drop policy if exists "pose_references_anon_write" on public.pose_references;

create policy "pose_references_anon_read"
  on public.pose_references for select using (true);
create policy "pose_references_anon_write"
  on public.pose_references for all using (true) with check (true);

insert into public.pose_references (name) values
  ('standing'),
  ('sitting'),
  ('walking'),
  ('leaning'),
  ('over-shoulder'),
  ('hands-on-hips'),
  ('mirror-ootd'),
  ('candid')
on conflict (name) do nothing;
