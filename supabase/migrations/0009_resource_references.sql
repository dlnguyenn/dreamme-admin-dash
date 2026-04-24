-- Resources "References" subtab: admin pastes TikTok slideshow URLs and we
-- scrape the carousel images into our own Storage bucket so creators can
-- scroll through slide-by-slide with admin-authored notes under each slide.
-- TikTok CDN URLs expire, so every slide image is re-hosted under
-- `dreamme-admin-internal-images/references/{id}/slide-{i}-{short}.{ext}`.

create table if not exists public.resource_references (
  id uuid primary key default gen_random_uuid(),
  tiktok_url text not null,
  title text,
  caption text,
  author_username text,
  -- Array of { image_url: text, note: text } objects in display order.
  slides jsonb not null default '[]'::jsonb,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dedup on URL: a repeat paste hits the unique index, not a duplicate row.
create unique index if not exists resource_references_tiktok_url_idx
  on public.resource_references (tiktok_url);
create index if not exists resource_references_created_at_idx
  on public.resource_references (created_at desc);

-- Keep updated_at honest on edits (notes get re-saved on blur).
create or replace function public.resource_references_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists resource_references_touch_updated_at
  on public.resource_references;
create trigger resource_references_touch_updated_at
  before update on public.resource_references
  for each row execute function public.resource_references_touch_updated_at();
