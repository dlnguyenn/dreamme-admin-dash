-- Background Studio: purchasable home-screen backgrounds for Sushi. One row
-- per saved background; the image lives in the public mcp-image-generations
-- bucket. Written by /api/background-studio/items (service role), read by
-- the dash. Same RLS convention as 0080_accessory_generations.

create table if not exists public.shop_backgrounds (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  -- the theme description it was generated from
  theme text not null,
  image_url text not null,
  model text,
  source text not null default 'generated' check (source in ('generated', 'import')),
  created_at timestamptz not null default now()
);

create index if not exists shop_backgrounds_created_idx
  on public.shop_backgrounds (created_at);

alter table public.shop_backgrounds enable row level security;

drop policy if exists "shop_backgrounds_read" on public.shop_backgrounds;
create policy "shop_backgrounds_read" on public.shop_backgrounds
  for select using (true);
