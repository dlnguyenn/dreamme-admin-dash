-- Kill-schedule automation: rows describe "on date X, pause the bottom N ads
-- in ad set Y, ranked by criterion." The cron at /api/cron/cull-variants
-- reads this table daily and executes any unexecuted row whose target_date
-- is today or earlier.

create table if not exists public.cull_schedule (
  id uuid primary key default gen_random_uuid(),
  adset_id text not null,
  adset_label text not null,
  phase_index integer not null,
  target_date date not null,
  criterion text not null check (criterion in ('ctr', 'reported_trial_cpa')),
  window_days integer not null default 3,
  cut_count integer not null default 1,
  -- Optional safety: skip cull if the bottom-N's worst metric is within this
  -- ratio of the best-performing ad. e.g. 0.7 = "only cull if bottom is <70%
  -- of top." For trial CPA, the ratio inverts (cull if worst is >1.43x best).
  min_ratio_threshold numeric default null,
  executed_at timestamptz default null,
  executed_log text default null,
  notes text default null,
  unique (adset_id, phase_index)
);

create index if not exists cull_schedule_target_date_idx
  on public.cull_schedule (target_date);
create index if not exists cull_schedule_pending_idx
  on public.cull_schedule (target_date) where executed_at is null;

alter table public.cull_schedule enable row level security;

drop policy if exists "cull_schedule_anon_read" on public.cull_schedule;
drop policy if exists "cull_schedule_anon_write" on public.cull_schedule;

create policy "cull_schedule_anon_read" on public.cull_schedule
  for select using (true);
create policy "cull_schedule_anon_write" on public.cull_schedule
  for all using (true) with check (true);

-- Pre-populate with the AI Video Test + Agency Video Test schedules.
-- AI test launched 2026-05-15, Agency test launched 2026-05-16.

insert into public.cull_schedule
  (adset_id, adset_label, phase_index, target_date, criterion, window_days, cut_count, min_ratio_threshold, notes)
values
  -- AI Video Test (120243985431000622) — 5 ads, 14-day, decision May 29.
  -- Phase 1 cull was originally May 19 but Option C delayed observation
  -- to Sunday May 18; if delivery picked up, run cull May 19 morning.
  ('120243985431000622', 'AI Video Test — Phase 1 (CTR cull)',
    1, '2026-05-19', 'ctr', 3, 2, 0.7,
    '5 ads, kill bottom 2 by CTR. Skip if all CTRs within 30% of top (signal is noisy at low impressions).'),
  ('120243985431000622', 'AI Video Test — Phase 2 (Trial CPA cull)',
    2, '2026-05-23', 'reported_trial_cpa', 4, 1, null,
    '3 surviving ads, kill bottom 1 by reported trial CPA.'),

  -- Agency Video Test (120244041045720622) — 7 ads, 10-day, decision May 26.
  ('120244041045720622', 'Agency Video Test — Phase 1 (CTR cull)',
    1, '2026-05-19', 'ctr', 3, 4, 0.7,
    '7 ads, kill bottom 4 by CTR.'),
  ('120244041045720622', 'Agency Video Test — Phase 2 (Trial CPA cull)',
    2, '2026-05-23', 'reported_trial_cpa', 4, 1, null,
    '3 surviving ads, kill bottom 1 by reported trial CPA.')
on conflict (adset_id, phase_index) do nothing;

-- Audit log of cron executions (separate from the schedule rows for clarity).
create table if not exists public.cull_execution_log (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references public.cull_schedule(id),
  ran_at timestamptz not null default now(),
  ok boolean not null,
  paused_ad_ids text[],
  ranked_summary jsonb,
  error text
);

alter table public.cull_execution_log enable row level security;
drop policy if exists "cull_execution_log_anon_read" on public.cull_execution_log;
drop policy if exists "cull_execution_log_anon_write" on public.cull_execution_log;
create policy "cull_execution_log_anon_read" on public.cull_execution_log
  for select using (true);
create policy "cull_execution_log_anon_write" on public.cull_execution_log
  for all using (true) with check (true);
