-- Deep Research mode — Lightreel-style viral-content research runs.
-- One row per run; all working state lives in phase_state (jsonb) so the
-- client-driven stepper can advance a run one bounded chunk at a time and
-- resume after any interruption. Strong finds are ALSO upserted into
-- viral_app_posts (source='search', source_detail='research:<run id>'),
-- so the Inspo feed benefits from every run.

create table if not exists public.growth_research_runs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  status text not null default 'planning'
    check (status in ('planning','seeding','expanding','inspecting','synthesizing','done','failed')),
  -- seed queries, expansion phrases, candidate array w/ per-video coding,
  -- inspect cursor — the whole run state machine.
  phase_state jsonb not null default '{}'::jsonb,
  report_md text,
  model text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists growth_research_runs_created_idx
  on public.growth_research_runs (created_at desc);

alter table public.growth_research_runs enable row level security;
drop policy if exists "growth_research_runs_anon_read" on public.growth_research_runs;
create policy "growth_research_runs_anon_read" on public.growth_research_runs
  for select using (true);
-- writes: service-role only (0039 pattern)
