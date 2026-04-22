-- Spend dashboard: per-vendor line items, rolled up client-side.

create table if not exists public.spend_line_items (
  id uuid primary key default gen_random_uuid(),
  vendor text not null check (vendor in ('anthropic','google','apify','vercel','supabase','business_cc','other')),
  category text not null check (category in ('ai','business')),
  amount_usd numeric(12,2) not null,
  period_start date not null,
  period_end date not null,
  source text not null check (source in ('api','manual','csv')) default 'manual',
  metadata jsonb,
  note text,
  created_at timestamptz not null default now(),
  unique (vendor, period_start, period_end, source)
);

create index if not exists spend_line_items_period_idx
  on public.spend_line_items (period_start desc);
create index if not exists spend_line_items_vendor_idx
  on public.spend_line_items (vendor);

alter table public.spend_line_items enable row level security;

drop policy if exists "spend_line_items_anon_read" on public.spend_line_items;
drop policy if exists "spend_line_items_anon_write" on public.spend_line_items;

create policy "spend_line_items_anon_read" on public.spend_line_items
  for select using (true);
create policy "spend_line_items_anon_write" on public.spend_line_items
  for all using (true) with check (true);


-- Feature requests: triage queue for user-submitted product asks.

create table if not exists public.feature_requests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  status text not null check (status in ('new','planned','in_progress','shipped','declined')) default 'new',
  epic text,
  submitter_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feature_requests_status_idx
  on public.feature_requests (status);
create index if not exists feature_requests_created_at_idx
  on public.feature_requests (created_at desc);

alter table public.feature_requests enable row level security;

drop policy if exists "feature_requests_anon_read" on public.feature_requests;
drop policy if exists "feature_requests_anon_write" on public.feature_requests;

create policy "feature_requests_anon_read" on public.feature_requests
  for select using (true);
create policy "feature_requests_anon_write" on public.feature_requests
  for all using (true) with check (true);
