-- Phase 1 of the self-improving hook system.
-- Adds the link from generated_hooks -> the resulting tiktok_post and
-- the persona-relative performance label that downstream tools use to
-- learn from outcomes. No embeddings yet (Phase 2).

-- Link generated hook -> resulting post.
alter table public.generated_hooks
  add column if not exists deployed_at timestamptz,
  add column if not exists posted_post_id uuid references public.tiktok_posts(id) on delete set null,
  add column if not exists match_confidence real,
  add column if not exists match_source text
    check (match_source is null or match_source in ('auto_normalized','auto_embedding','manual'));

create index if not exists generated_hooks_posted_post_id_idx
  on public.generated_hooks (posted_post_id);
create index if not exists generated_hooks_unmatched_idx
  on public.generated_hooks (persona, created_at desc)
  where posted_post_id is null;

-- Persona-relative performance labels on each scraped post.
alter table public.tiktok_posts
  add column if not exists performance_ratio real,
  add column if not exists performance_class text
    check (performance_class is null or performance_class in ('flop','mid','hit'));

create index if not exists tiktok_posts_performance_class_idx
  on public.tiktok_posts (persona, performance_class);

-- Rolling per-persona baseline used to compute performance_ratio.
-- Recomputed nightly by /api/cron/baselines.
create table if not exists public.persona_baselines (
  persona text primary key,
  rolling_median_views bigint not null,
  rolling_p25_views bigint not null,
  rolling_p75_views bigint not null,
  sample_size int not null,
  window_start timestamptz not null,
  computed_at timestamptz not null default now()
);

alter table public.persona_baselines enable row level security;
drop policy if exists "persona_baselines_anon_read" on public.persona_baselines;
drop policy if exists "persona_baselines_anon_write" on public.persona_baselines;
create policy "persona_baselines_anon_read" on public.persona_baselines for select using (true);
create policy "persona_baselines_anon_write" on public.persona_baselines for all using (true) with check (true);
