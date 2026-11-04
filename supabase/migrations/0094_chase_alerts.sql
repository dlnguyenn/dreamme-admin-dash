-- Chase transaction alerts: business spend from Chase's own alert emails.
--
-- Chase emails dlnguyenn@gmail.com on every business-account transaction;
-- a Gmail filter forwards those to dan@dreamme.life. /api/cron/chase-alerts
-- (daily) reads them with the Support Inbox's read-only Gmail token and
-- stores one row per email here, keyed by Gmail message id, so re-runs are
-- idempotent. src/lib/finance/chase-alerts.ts parses them; the Spend tab
-- shows monthly spend by category and the ingest's freshness.
--
-- Emails that aren't transactions (balance, statement, security notices)
-- are kept as status 'ignore'. A Chase email with money in it that the
-- parser can't read is kept as 'unparsed' and surfaced, never dropped. The
-- extracted text is stored so a parser fix (PARSER_VERSION bump) re-parses
-- old rows without going back to Gmail.
create table if not exists public.chase_alert_messages (
  gmail_id text primary key,
  message_id text,                      -- RFC 822 Message-ID
  received_at timestamptz,              -- Date header
  from_email text,
  subject text,
  html_text text,                       -- HTML body as text (table rows -> "Label | value")
  text_body text,                       -- text/plain part
  status text not null check (status in ('txn','ignore','unparsed')),
  reason text,                          -- why ignored / unparsed
  txn_date date,                        -- transaction date (US Eastern)
  amount numeric(12,2),                 -- signed: negative = money out
  description text,                     -- phrased like a Chase CSV row
  kind text,                            -- card, zelle_out, ach_out, wire_out, deposit, ...
  last4 text,                           -- account as written in the email (0360 before roll-up)
  parser_version int not null,
  first_seen_at timestamptz not null default now(),
  parsed_at timestamptz not null default now()
);

create index if not exists chase_alert_messages_txn_date_idx
  on public.chase_alert_messages (txn_date desc) where status = 'txn';
create index if not exists chase_alert_messages_received_idx
  on public.chase_alert_messages (received_at desc);

comment on table public.chase_alert_messages is
  'Chase alert emails (forwarded to dan@dreamme.life), one row per Gmail message, parsed into business transactions.';

-- One row per ingest run, so "no Chase mail yet" and "the cron is broken"
-- look different on the Spend tab.
create table if not exists public.chase_alert_runs (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  trigger text not null default 'cron',  -- cron | manual
  ok boolean not null,
  listed int,
  inserted int,
  reparsed int,
  truncated boolean,
  error text
);

create index if not exists chase_alert_runs_ran_at_idx
  on public.chase_alert_runs (ran_at desc);

alter table public.chase_alert_messages enable row level security;
alter table public.chase_alert_runs enable row level security;
-- service-role only: no policies.
