-- SynthID Research run log. Internal-only — every bypass attempt from the
-- "SynthID Research" admin screen records the input/output Storage paths
-- and detector scores so we have an audit trail of what was tested.
--
-- Storage layout (in `dreamme-admin-internal-images`):
--   research/synthid/{id}/input.{png|jpg}
--   research/synthid/{id}/output.png

create table if not exists public.synthid_research_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_email text,
  input_path text not null,
  output_path text,
  version text not null check (version in ('v3','v4')),
  strength text,
  pre_scores jsonb,
  post_scores jsonb,
  notes text
);

create index if not exists synthid_research_runs_created_at_idx
  on public.synthid_research_runs (created_at desc);
