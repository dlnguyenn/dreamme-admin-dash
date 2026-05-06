-- Image Studio + self-hosted MCP image server. Every Gemini image generation
-- (whether triggered from the admin dash UI or from a claude.ai custom
-- connector calling the MCP endpoint) records a row here so we have a
-- gallery + audit trail. Public images live in the dedicated
-- `mcp-image-generations` bucket so they can be fetched directly by URL
-- without signed-URL expiry.

create table if not exists public.image_generations (
  id uuid primary key default gen_random_uuid(),
  prompt text not null,
  aspect_ratio text,
  image_url text not null,
  gemini_model text,
  source text,                  -- 'mcp' | 'dashboard'
  created_at timestamptz not null default now()
);

create index if not exists image_generations_created_at_idx
  on public.image_generations (created_at desc);

alter table public.image_generations enable row level security;
drop policy if exists "image_generations_anon_read" on public.image_generations;
drop policy if exists "image_generations_anon_write" on public.image_generations;
create policy "image_generations_anon_read"
  on public.image_generations for select using (true);
create policy "image_generations_anon_write"
  on public.image_generations for all using (true) with check (true);

-- Public bucket for generated images. The MCP caller gets the public URL
-- directly so they can embed/download without signed-URL expiry.
insert into storage.buckets (id, name, public)
values ('mcp-image-generations', 'mcp-image-generations', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "mcp_image_generations_public_read" on storage.objects;
drop policy if exists "mcp_image_generations_anon_write" on storage.objects;

create policy "mcp_image_generations_public_read" on storage.objects
  for select using (bucket_id = 'mcp-image-generations');

create policy "mcp_image_generations_anon_write" on storage.objects
  for insert with check (bucket_id = 'mcp-image-generations');
