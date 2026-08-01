-- Stripe customer name index for the Support Inbox.
--
-- Stripe CANNOT search customers by name: customer.name is null on every
-- DreamMe customer, and billing_details.name (which IS populated, on ~98%
-- of charges) is an unsupported search field on /charges/search. So we
-- mirror name + email per customer here, refreshed incrementally from the
-- charge list by the support cron, and search it with SQL instead.
--
-- Purpose: support email often arrives from a different address than the
-- card on file (writes from a personal gmail, pays from a work address),
-- so the email-based resolver misses a paying customer entirely.

create table if not exists stripe_customer_names (
  customer_id    text primary key,
  name           text,
  email          text,
  last_charge_at timestamptz,
  updated_at     timestamptz not null default now()
);

-- Search is ilike '%term%' on both columns; plain btree can't serve a
-- leading wildcard, so use trigram indexes when pg_trgm is available.
create extension if not exists pg_trgm;
create index if not exists stripe_customer_names_name_trgm
  on stripe_customer_names using gin (lower(name) gin_trgm_ops);
create index if not exists stripe_customer_names_email_trgm
  on stripe_customer_names using gin (lower(email) gin_trgm_ops);
-- Drives the incremental refresh watermark.
create index if not exists stripe_customer_names_last_charge_idx
  on stripe_customer_names (last_charge_at desc);
