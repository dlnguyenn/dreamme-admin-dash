-- Plaid bank-account integration for spend tracking.
--
-- Two tables:
--   plaid_items        — one row per linked institution (currently just
--                        the Chase business card). Holds the long-lived
--                        access_token Plaid issues after a successful
--                        Link flow, plus the /transactions/sync cursor.
--   plaid_transactions — one row per individual transaction. Lets us
--                        reconstruct daily spend totals from scratch
--                        each sync, which keeps modifications and
--                        removals correct without any drift.
--
-- The 'plaid' source is added to spend_line_items so the dashboard can
-- distinguish Plaid-driven rows from manual / csv / api ones.
--
-- Both tables RLS-deny everything by default — only the service-role
-- key can touch them. access_token is sensitive credential material;
-- never expose to the anon key.

create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  item_id text not null unique,
  access_token text not null,
  institution_name text,
  cursor text,
  last_sync_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plaid_transactions (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.plaid_items(item_id) on delete cascade,
  plaid_transaction_id text not null unique,
  account_id text not null,
  date date not null,
  authorized_date date,
  name text not null,
  merchant_name text,
  amount numeric(12,2) not null,
  iso_currency_code text,
  pending boolean not null default false,
  category text[],
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plaid_transactions_item_date_idx
  on public.plaid_transactions (item_id, date desc);
create index if not exists plaid_transactions_date_idx
  on public.plaid_transactions (date desc) where removed_at is null;

alter table public.plaid_items enable row level security;
alter table public.plaid_transactions enable row level security;

-- Deny anon entirely — these tables hold credentials and PII-adjacent
-- transaction data. Server routes use the service role.
drop policy if exists "plaid_items_anon_deny" on public.plaid_items;
create policy "plaid_items_anon_deny" on public.plaid_items
  for all using (false) with check (false);

drop policy if exists "plaid_transactions_anon_deny" on public.plaid_transactions;
create policy "plaid_transactions_anon_deny" on public.plaid_transactions
  for all using (false) with check (false);

-- Extend the spend_line_items source enum so 'plaid' is a first-class
-- citizen alongside 'api', 'manual', 'csv'.
alter table public.spend_line_items
  drop constraint if exists spend_line_items_source_check;
alter table public.spend_line_items
  add constraint spend_line_items_source_check
  check (source in ('api','manual','csv','plaid'));
