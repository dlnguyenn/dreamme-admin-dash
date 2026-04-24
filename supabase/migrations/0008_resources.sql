-- Resources dashboard: admin-curated reference images + external drive/URL
-- links surfaced to content creators. Flat list + tag search, no categories.
-- Images live in Supabase Storage (bucket `dreamme-admin-internal-images`)
-- under the `resources/` prefix; links store just the URL. `description`
-- holds the how-to-use caption.

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('image','link')),
  title text not null,
  description text,
  image_url text,
  link_url text,
  tags text[] not null default '{}',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One of image_url / link_url must be populated, matching the kind.
  constraint resources_payload_chk check (
    (kind = 'image' and image_url is not null) or
    (kind = 'link'  and link_url  is not null)
  )
);

create index if not exists resources_kind_idx on public.resources (kind);
create index if not exists resources_tags_idx on public.resources using gin (tags);
create index if not exists resources_created_at_idx
  on public.resources (created_at desc);

-- Keep updated_at honest on edits.
create or replace function public.resources_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists resources_touch_updated_at on public.resources;
create trigger resources_touch_updated_at
  before update on public.resources
  for each row execute function public.resources_touch_updated_at();
