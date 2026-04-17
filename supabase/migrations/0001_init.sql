-- DreamMe Admin Dashboard — initial schema
-- Run via: `npx supabase db push` (local) or apply in the Supabase SQL editor for prod.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- personas: one row per DreamMe TikTok persona. Seeded below.
-- ---------------------------------------------------------------------------
create table if not exists public.personas (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  display_name text not null,
  created_at   timestamptz not null default now()
);

insert into public.personas (slug, display_name) values
  ('andrea', 'Andrea'),
  ('emma',   'Emma'),
  ('olivia', 'Olivia')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- workflow_runs: one row per N8N execution of the Daily Content Pipeline.
-- ---------------------------------------------------------------------------
create table if not exists public.workflow_runs (
  id                uuid primary key default gen_random_uuid(),
  n8n_execution_id  text unique,
  triggered_by      text,                       -- 'schedule' | 'manual:<email>' | 'n8n'
  status            text not null default 'completed',
  started_at        timestamptz,
  finished_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- captions: the long-form TikTok caption. Lives independently so the
-- "All Captions" bucket can list every caption regardless of image state.
-- ---------------------------------------------------------------------------
create table if not exists public.captions (
  id             uuid primary key default gen_random_uuid(),
  text           text not null,
  char_count     integer generated always as (char_length(text)) stored,
  source_run_id  uuid references public.workflow_runs(id) on delete set null,
  tags           text[] not null default '{}',
  created_at     timestamptz not null default now()
);

create index if not exists captions_created_at_idx on public.captions (created_at desc);

-- ---------------------------------------------------------------------------
-- content_items: one row per persona image per run. References its caption
-- so the image detail page can show the caption underneath.
-- ---------------------------------------------------------------------------
create table if not exists public.content_items (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid references public.workflow_runs(id) on delete cascade,
  persona_id    uuid not null references public.personas(id) on delete restrict,
  image_path    text not null,                  -- Storage key, e.g. andrea/<run_id>.png
  caption_id    uuid references public.captions(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists content_items_persona_created_idx
  on public.content_items (persona_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security: the app reads/writes via the service-role key
-- server-side, so deny anon/authenticated direct access. The email allowlist
-- is enforced in Next.js middleware + API route handlers.
-- ---------------------------------------------------------------------------
alter table public.personas       enable row level security;
alter table public.workflow_runs  enable row level security;
alter table public.captions       enable row level security;
alter table public.content_items  enable row level security;

-- Authenticated users can read everything; writes only via service role.
create policy "authenticated read personas"
  on public.personas for select to authenticated using (true);
create policy "authenticated read runs"
  on public.workflow_runs for select to authenticated using (true);
create policy "authenticated read captions"
  on public.captions for select to authenticated using (true);
create policy "authenticated read content_items"
  on public.content_items for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Storage bucket for persona images (private; signed URLs only).
-- Create manually if `storage.buckets` is not writable via migration on your
-- Supabase plan; the `on conflict do nothing` keeps re-runs safe.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('persona-images', 'persona-images', false)
on conflict (id) do nothing;

create policy "authenticated read persona images"
  on storage.objects for select to authenticated
  using (bucket_id = 'persona-images');
