-- Per-call AI usage events. Each row is one model call (today: Gemini
-- image edits). Daily totals are rolled up into spend_line_items by the
-- /api/cron/spend/gemini job so the existing SpendDashboard reads no new
-- table.

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  vendor text not null check (vendor in ('google','anthropic','apify')),
  model text not null,
  route text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  image_count integer not null default 0,
  computed_usd numeric(12,6) not null default 0,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_vendor_created_idx
  on public.ai_usage_events (vendor, created_at desc);
create index if not exists ai_usage_events_created_at_idx
  on public.ai_usage_events (created_at desc);

alter table public.ai_usage_events enable row level security;

drop policy if exists "ai_usage_events_anon_read" on public.ai_usage_events;
drop policy if exists "ai_usage_events_anon_write" on public.ai_usage_events;

create policy "ai_usage_events_anon_read" on public.ai_usage_events
  for select using (true);
create policy "ai_usage_events_anon_write" on public.ai_usage_events
  for all using (true) with check (true);
