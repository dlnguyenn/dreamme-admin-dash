-- Phase 2 of the self-improving hook system.
-- Adds pgvector embeddings + hook_families table for fuzzy similarity
-- clustering and fatigue scoring. All embedding columns are nullable so
-- the migration is safe to apply before VOYAGE_API_KEY is set.

create extension if not exists vector;

alter table public.tiktok_posts
  add column if not exists embedding vector(1024),
  add column if not exists family_id uuid;

alter table public.generated_hooks
  add column if not exists embedding vector(1024),
  add column if not exists family_id uuid;

create table if not exists public.hook_families (
  id uuid primary key default gen_random_uuid(),
  centroid vector(1024) not null,
  exemplar_text text not null,
  exemplar_post_id uuid references public.tiktok_posts(id) on delete set null,
  exemplar_generated_id uuid references public.generated_hooks(id) on delete set null,
  category text,
  member_count int not null default 1,
  first_seen_at timestamptz not null default now(),
  last_use_at timestamptz,
  last_hit_at timestamptz,
  recent_flop_count int not null default 0,
  total_uses_14d int not null default 0,
  cross_persona_uses_14d int not null default 0,
  fatigue_score real not null default 0,
  fatigue_reason text,
  cooldown_until timestamptz,
  computed_at timestamptz not null default now()
);

-- Generated hooks reference their assigned family. ALTER TABLE in
-- Postgres has no IF NOT EXISTS for constraints, so guard with DO blocks.
do $$ begin
  alter table public.generated_hooks
    add constraint generated_hooks_family_fk
    foreign key (family_id) references public.hook_families(id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.tiktok_posts
    add constraint tiktok_posts_family_fk
    foreign key (family_id) references public.hook_families(id) on delete set null;
exception when duplicate_object then null;
end $$;

create index if not exists hook_families_fatigue_idx
  on public.hook_families (fatigue_score desc);
create index if not exists hook_families_cooldown_idx
  on public.hook_families (cooldown_until)
  where cooldown_until is not null;

-- ANN index for fast nearest-centroid lookup. ivfflat needs at least one
-- row before the index becomes useful; lists tuning is for ~100s-1000s
-- of families.
create index if not exists hook_families_centroid_idx
  on public.hook_families using ivfflat (centroid vector_cosine_ops)
  with (lists = 50);

-- Posts/hooks lookup by family.
create index if not exists tiktok_posts_family_idx
  on public.tiktok_posts (family_id)
  where family_id is not null;
create index if not exists generated_hooks_family_idx
  on public.generated_hooks (family_id)
  where family_id is not null;

alter table public.hook_families enable row level security;
drop policy if exists "hook_families_anon_read" on public.hook_families;
drop policy if exists "hook_families_anon_write" on public.hook_families;
create policy "hook_families_anon_read" on public.hook_families for select using (true);
create policy "hook_families_anon_write" on public.hook_families for all using (true) with check (true);

-- Per-family aggregates over the last 14 days. Called by /api/cron/fatigue
-- which then computes fatigue_score in JS (see src/lib/families.ts) and
-- writes back to hook_families.
create or replace function public.family_fatigue_inputs()
returns table (
  family_id uuid,
  total_uses_14d int,
  recent_flop_count_14d int,
  cross_persona_uses_14d int,
  last_use_at timestamptz,
  last_hit_at timestamptz
)
language sql
stable
as $$
  with deployed as (
    select gh.family_id,
           gh.persona,
           gh.deployed_at,
           tp.performance_class
    from public.generated_hooks gh
    left join public.tiktok_posts tp on tp.id = gh.posted_post_id
    where gh.family_id is not null
      and gh.deployed_at is not null
  )
  select
    hf.id as family_id,
    coalesce(count(d.deployed_at) filter (where d.deployed_at > now() - interval '14 days')::int, 0) as total_uses_14d,
    coalesce(count(d.deployed_at) filter (where d.deployed_at > now() - interval '14 days' and d.performance_class = 'flop')::int, 0) as recent_flop_count_14d,
    coalesce(count(distinct d.persona) filter (where d.deployed_at > now() - interval '14 days')::int, 0) as cross_persona_uses_14d,
    max(d.deployed_at) as last_use_at,
    max(case when d.performance_class = 'hit' then d.deployed_at end) as last_hit_at
  from public.hook_families hf
  left join deployed d on d.family_id = hf.id
  group by hf.id;
$$;

-- Per-persona category coverage over the last 30 days. Used by the
-- generator to surface "under-explored" angles to push the model toward.
create or replace function public.category_coverage(p_persona text)
returns table (category text, post_count int, avg_performance_ratio real)
language sql
stable
as $$
  select
    coalesce(category, 'other') as category,
    count(*)::int as post_count,
    coalesce(avg(performance_ratio)::real, 0) as avg_performance_ratio
  from public.tiktok_posts
  where persona = p_persona
    and posted_at > now() - interval '30 days'
  group by 1
  order by post_count asc;
$$;
