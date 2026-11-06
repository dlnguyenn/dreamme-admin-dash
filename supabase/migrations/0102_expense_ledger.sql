-- Expense ledger: every business transaction on Chase, one row each, for taxes.
--
-- Rows come from two places. The daily Chase ingest adds one per alert email,
-- and Chase CSVs uploaded on the Spend tab add history plus what alerts never
-- cover (fees, interest, statement credits). Both insert with "ignore
-- duplicates" on id, so a category or note someone edited is never overwritten.
-- Rows aren't deleted: a personal charge gets the Personal category instead, or
-- the next CSV upload would add it back.
create table if not exists public.expense_ledger (
  id text primary key,                  -- alert:<gmail id> or csv:<account>:<date>:<hash>:<n>
  txn_date date not null,
  account text not null,                -- empty when an alert email couldn't be read
  description text not null,
  amount numeric(12,2),                 -- signed: negative = money out. Null until someone reads an unreadable alert
  category text not null,
  review text not null default '',      -- open question about this row; empty = nothing to check
  notes text not null default '',
  source text not null check (source in ('Chase CSV','Chase alert')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expense_ledger_txn_date_idx on public.expense_ledger (txn_date desc);

comment on table public.expense_ledger is
  'Business transactions on Chase for tax filing. Added by the Chase alert ingest and Spend tab CSV uploads, edited on the Spend tab.';

alter table public.expense_ledger enable row level security;
-- service-role only: no policies.
