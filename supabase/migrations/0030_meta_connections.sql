-- Meta (Facebook) OAuth connections — long-lived Marketing API tokens obtained
-- via the "Login with Facebook" flow (/api/oauth/meta/*), consumed by the Ads
-- MCP and ads syncs instead of a hand-pasted META_ACCESS_TOKEN env var.
--
-- Multi-tenant-ready: owner_id is nullable now (single shared tenant) and gets
-- populated once real per-user auth exists. Server-only (service role): RLS
-- denies anon so the stored access_token never leaves via the public REST API.
-- (Tokens are plaintext for v1 — encrypt at rest before onboarding external
-- customers.)

create table if not exists public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id text,                                  -- future per-tenant user id; null = shared
  fb_user_id text,                                -- Facebook user who authorized
  fb_user_name text,
  business_id text,
  access_token text not null,                     -- long-lived user token (~60d)
  token_expires_at timestamptz,
  scopes text,
  ad_accounts jsonb,                              -- granted accounts [{id,name}]
  default_ad_account_id text,
  status text not null default 'active',          -- active | revoked | error
  is_default boolean not null default true,       -- the connection the MCP uses (single-tenant)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meta_connections_active_idx
  on public.meta_connections (status, is_default, updated_at desc);

alter table public.meta_connections enable row level security;

-- Block all anon access; the OAuth route handlers go through the service role.
drop policy if exists "meta_connections_no_anon" on public.meta_connections;
create policy "meta_connections_no_anon" on public.meta_connections for all using (false) with check (false);
