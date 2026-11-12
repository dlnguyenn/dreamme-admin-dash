-- One row per automatic experiment check (src/app/api/cron/experiment-digest).
-- The newest row is what the Overview panel reads, so the panel renders
-- without calling RevenueCat on every page load and can show how fresh it is.
-- The older rows are the proof the job keeps running, which is the point.
create table if not exists public.experiment_status (
  id bigserial primary key,
  checked_at timestamptz not null default now(),
  -- { headline, counts: {...}, items: [{ id, title, state, stage, reading, attention }] }
  summary jsonb not null default '{}'::jsonb,
  -- true when this check also sent the weekly email
  emailed boolean not null default false,
  -- why RevenueCat could not be read, when it could not
  rc_error text
);

create index if not exists experiment_status_checked_at_idx
  on public.experiment_status (checked_at desc);

comment on table public.experiment_status is
  'Snapshots of the experiment log''s health, written by the experiment-digest cron. Newest row feeds the Overview panel.';

alter table public.experiment_status enable row level security;
revoke all on public.experiment_status from anon, authenticated;
revoke all on sequence public.experiment_status_id_seq from anon, authenticated;
