-- Accessory Studio: one row per saved companion-fish accessory SVG. Written
-- by /api/accessory-studio/items (service role), read by the dash. The SVG
-- and its raster stages live in the public mcp-image-generations bucket.
-- Same RLS convention as 0079_ad_breakdowns: anon reads, writes
-- service-role only.

create table if not exists public.accessory_generations (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  item text not null,
  subject text not null,
  slot text not null check (slot in ('hat', 'glasses', 'neck', 'handheld')),
  -- 'fish' = drawn on Sushi then extracted; 'match' = standalone, copying an
  -- existing accessory's silhouette
  mode text not null check (mode in ('fish', 'match')),
  model text,
  onfish_url text,
  solo_url text,
  svg_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists accessory_generations_created_idx
  on public.accessory_generations (created_at desc);

alter table public.accessory_generations enable row level security;

drop policy if exists "accessory_generations_read" on public.accessory_generations;
create policy "accessory_generations_read" on public.accessory_generations
  for select using (true);
