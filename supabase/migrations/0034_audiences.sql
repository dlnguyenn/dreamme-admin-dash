-- Module 4 — Automated audience sync to Meta (closed-loop RC→Meta).
--
-- Backs the upgraded /api/cron/refresh-audiences pipeline: a customer snapshot
-- (so we can detect churn by diffing over time — RC v2 cannot enumerate churned
-- customers) and a registry of the Meta audiences we own (so each run reuses
-- stable audience IDs instead of creating orphans).

-- Per-customer snapshot. Service-role only: it stores HASHED emails (PII-ish),
-- and the dashboard never reads it directly. Only non-relay payers are tracked
-- (Apple relay emails can't match in Meta anyway). Lapsed status is derived by
-- the cron: customers that were 'active' in a prior run but absent this run get
-- flipped to 'lapsed' (became_lapsed_at set). That's the only churn signal RC v2
-- gives us.
create table if not exists public.rc_customer_snapshot (
  customer_id text primary key,
  email_sha256 text,                          -- SHA-256 of the (non-relay) email; null if none usable
  entitlement text,                           -- lookup_key of the active entitlement
  status text not null default 'active',      -- 'active' | 'lapsed'
  starts_at timestamptz,                       -- entitlement start (tenure → high-LTV proxy)
  expires_at timestamptz,
  first_active_at timestamptz not null default now(),
  last_active_at timestamptz,                  -- last run that saw this customer active
  became_lapsed_at timestamptz,
  last_run_at timestamptz,                     -- stamp of the run that last upserted this row as active
  updated_at timestamptz not null default now()
);

create index if not exists rc_customer_snapshot_status_idx on public.rc_customer_snapshot (status);
create index if not exists rc_customer_snapshot_email_idx on public.rc_customer_snapshot (email_sha256);
create index if not exists rc_customer_snapshot_tenure_idx on public.rc_customer_snapshot (status, starts_at);

alter table public.rc_customer_snapshot enable row level security;
drop policy if exists "rc_customer_snapshot_no_anon" on public.rc_customer_snapshot;
create policy "rc_customer_snapshot_no_anon" on public.rc_customer_snapshot for all using (false) with check (false);

-- Registry of the Meta audiences this pipeline owns, keyed by purpose so each
-- run reuses the same audience id. No PII → anon-readable (for a future
-- dashboard panel); writes happen via the service role (bypasses RLS).
create table if not exists public.meta_audience_registry (
  id uuid primary key default gen_random_uuid(),
  purpose text not null unique,                -- 'suppression_active' | 'high_ltv_seed' | 'lookalike_high_ltv' | 'winback_lapsed'
  audience_id text,                            -- the Meta custom/lookalike audience id
  kind text,                                   -- 'custom' | 'lookalike' | 'suppression'
  origin_audience_id text,                     -- seed audience id (for lookalikes)
  country text,
  ratio numeric,
  member_count integer,
  last_synced_at timestamptz,
  note text,
  updated_at timestamptz not null default now()
);

alter table public.meta_audience_registry enable row level security;
drop policy if exists "meta_audience_registry_anon_read" on public.meta_audience_registry;
create policy "meta_audience_registry_anon_read" on public.meta_audience_registry for select using (true);
-- No anon write policy: the cron writes via the service role.

grant select on public.meta_audience_registry to anon, authenticated;
