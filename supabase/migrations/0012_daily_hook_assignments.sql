-- Daily hook assignment system.
--
-- Each cron run generates N hooks per persona tagged as either 'exploit'
-- (riffing on what's been working) or 'explore' (untried angles). One
-- hook per persona per day is then promoted into daily_hook_assignments
-- so the external N8N workflow can claim it deterministically and link
-- the resulting delivery back to the seed hook.
--
-- Personas are already opened up to all 8 in 0005_add_personas.sql.

-- 1. Tag generated hooks with their strategy.
alter table public.generated_hooks
  add column if not exists strategy text
    check (strategy is null or strategy in ('exploit','explore'));

create index if not exists generated_hooks_persona_strategy_created_idx
  on public.generated_hooks (persona, strategy, created_at desc);

-- 2. Link a delivery back to the hook that seeded it.
alter table public.deliveries
  add column if not exists source_hook_id uuid
    references public.generated_hooks(id) on delete set null;

create index if not exists deliveries_source_hook_id_idx
  on public.deliveries (source_hook_id);

-- 3. One pre-assigned hook per persona per day. N8N reads from here.
create table if not exists public.daily_hook_assignments (
  id uuid primary key default gen_random_uuid(),
  persona text not null check (persona in
    ('andrea','emma','olivia','mia','abby','diane','sydney','maddy')),
  assigned_date date not null,
  hook_id uuid not null references public.generated_hooks(id) on delete cascade,
  claimed_at timestamptz,
  delivery_id uuid references public.deliveries(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (persona, assigned_date)
);

create index if not exists daily_hook_assignments_date_persona_idx
  on public.daily_hook_assignments (assigned_date desc, persona);
create index if not exists daily_hook_assignments_hook_id_idx
  on public.daily_hook_assignments (hook_id);

alter table public.daily_hook_assignments enable row level security;

drop policy if exists "daily_hook_assignments_anon_read" on public.daily_hook_assignments;
drop policy if exists "daily_hook_assignments_anon_write" on public.daily_hook_assignments;

create policy "daily_hook_assignments_anon_read" on public.daily_hook_assignments
  for select using (true);
create policy "daily_hook_assignments_anon_write" on public.daily_hook_assignments
  for all using (true) with check (true);
