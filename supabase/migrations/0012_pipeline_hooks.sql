-- N8n Content Pipeline integration: a separate stream of generated hooks
-- driven by Opus 4.7 with explore/exploit logic based on each persona's
-- recent viral velocity. Kept distinct from the dashboard's
-- generated_hooks table so the daily cron + admin UI are unaffected.

create table if not exists public.pipeline_hooks (
  id uuid primary key default gen_random_uuid(),
  persona text not null check (persona in ('andrea','emma','olivia','mia','abby','diane','sydney','maddy')),
  hook_text text not null,
  rationale text,
  category text,
  -- Decision log: which mode produced this hook + the inputs that drove it
  mode text not null check (mode in ('explore','exploit')),
  viral_signal jsonb,                  -- {evaluated, viralCount, viralPosts: [{id, reason}], thresholds}
  inspired_by_post_ids uuid[] not null default '{}',
  -- Lifecycle: did n8n fetch this hook? Did it eventually become a post?
  used boolean not null default false,
  used_at timestamptz,
  posted_post_id uuid references public.tiktok_posts(id) on delete set null,
  deployed_at timestamptz,
  match_confidence real,
  match_source text check (match_source is null or match_source in ('auto_normalized','auto_embedding','manual')),
  -- Embedding for future dedup / cross-table family analytics
  embedding vector(1024),
  family_id uuid references public.hook_families(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pipeline_hooks_persona_created_idx
  on public.pipeline_hooks (persona, created_at desc);
create index if not exists pipeline_hooks_unmatched_idx
  on public.pipeline_hooks (persona, created_at desc)
  where posted_post_id is null;

alter table public.pipeline_hooks enable row level security;
drop policy if exists "pipeline_hooks_anon_read" on public.pipeline_hooks;
drop policy if exists "pipeline_hooks_anon_write" on public.pipeline_hooks;
create policy "pipeline_hooks_anon_read" on public.pipeline_hooks for select using (true);
create policy "pipeline_hooks_anon_write" on public.pipeline_hooks for all using (true) with check (true);
