-- DreamMe Internal Dashboard schema
-- Two tables: deliveries (one row per persona image+caption from the n8n pipeline)
-- and saved_captions (the caption library bucket).

create extension if not exists "pgcrypto";

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  persona text not null check (persona in ('andrea','emma','olivia')),
  image_url text not null,
  caption text not null,
  posted boolean not null default false,
  starred boolean not null default false,
  in_library boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists deliveries_created_at_idx on public.deliveries (created_at desc);
create index if not exists deliveries_persona_idx on public.deliveries (persona);

create table if not exists public.saved_captions (
  id uuid primary key default gen_random_uuid(),
  source_delivery_id uuid references public.deliveries(id) on delete set null,
  persona text not null check (persona in ('andrea','emma','olivia')),
  caption text not null,
  posted boolean not null default false,
  starred boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists saved_captions_created_at_idx on public.saved_captions (created_at desc);
create index if not exists saved_captions_persona_idx on public.saved_captions (persona);

-- RLS. The dashboard is gated by a shared team password on the client, but it
-- still talks to Supabase with the public anon key. So we allow anon to read
-- and mutate both tables. Lock this down further with real auth if/when you
-- migrate off the shared-password gate.
alter table public.deliveries enable row level security;
alter table public.saved_captions enable row level security;

drop policy if exists "deliveries_anon_read" on public.deliveries;
drop policy if exists "deliveries_anon_write" on public.deliveries;
drop policy if exists "saved_captions_anon_read" on public.saved_captions;
drop policy if exists "saved_captions_anon_write" on public.saved_captions;

create policy "deliveries_anon_read" on public.deliveries
  for select using (true);
create policy "deliveries_anon_write" on public.deliveries
  for all using (true) with check (true);

create policy "saved_captions_anon_read" on public.saved_captions
  for select using (true);
create policy "saved_captions_anon_write" on public.saved_captions
  for all using (true) with check (true);

-- Storage bucket for the images pushed from n8n. Public-read so the dashboard
-- can render them directly; uploads are authenticated (service role from n8n,
-- or the custom /api/ingest/content-pipeline endpoint).
insert into storage.buckets (id, name, public)
values ('dreamme-admin-internal-images', 'dreamme-admin-internal-images', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "images_public_read" on storage.objects;
drop policy if exists "images_anon_write" on storage.objects;

create policy "images_public_read" on storage.objects
  for select using (bucket_id = 'dreamme-admin-internal-images');

create policy "images_anon_write" on storage.objects
  for insert with check (bucket_id = 'dreamme-admin-internal-images');
