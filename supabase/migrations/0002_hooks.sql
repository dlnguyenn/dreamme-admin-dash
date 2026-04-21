-- Hook Analytics: scraped TikTok posts + AI-generated hook suggestions.

create table if not exists public.tiktok_posts (
  id uuid primary key default gen_random_uuid(),
  persona text not null check (persona in ('andrea','emma','olivia')),
  post_id text,
  post_url text not null unique,
  posted_at timestamptz,
  view_count bigint not null default 0,
  like_count bigint not null default 0,
  comment_count bigint not null default 0,
  share_count bigint not null default 0,
  caption text,
  first_slide_url text,
  first_slide_text text,
  hook_normalized text,
  category text,
  last_scraped_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists tiktok_posts_persona_views_idx
  on public.tiktok_posts (persona, view_count desc);
create index if not exists tiktok_posts_category_idx
  on public.tiktok_posts (category);
create index if not exists tiktok_posts_posted_at_idx
  on public.tiktok_posts (posted_at desc);
create index if not exists tiktok_posts_hook_normalized_idx
  on public.tiktok_posts (hook_normalized);

create table if not exists public.generated_hooks (
  id uuid primary key default gen_random_uuid(),
  persona text not null check (persona in ('andrea','emma','olivia')),
  hook_text text not null,
  rationale text,
  category text,
  inspired_by_post_ids uuid[] not null default '{}',
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists generated_hooks_persona_created_idx
  on public.generated_hooks (persona, created_at desc);

alter table public.tiktok_posts enable row level security;
alter table public.generated_hooks enable row level security;

drop policy if exists "tiktok_posts_anon_read" on public.tiktok_posts;
drop policy if exists "tiktok_posts_anon_write" on public.tiktok_posts;
drop policy if exists "generated_hooks_anon_read" on public.generated_hooks;
drop policy if exists "generated_hooks_anon_write" on public.generated_hooks;

create policy "tiktok_posts_anon_read" on public.tiktok_posts
  for select using (true);
create policy "tiktok_posts_anon_write" on public.tiktok_posts
  for all using (true) with check (true);

create policy "generated_hooks_anon_read" on public.generated_hooks
  for select using (true);
create policy "generated_hooks_anon_write" on public.generated_hooks
  for all using (true) with check (true);
