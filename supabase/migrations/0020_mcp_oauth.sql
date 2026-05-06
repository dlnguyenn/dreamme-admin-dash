-- OAuth 2.1 authorization server tables for the MCP image endpoint.
--
-- claude.ai custom connectors require OAuth 2.1 with dynamic client
-- registration + PKCE; these tables back the /.well-known discovery,
-- /api/oauth/{register,authorize,token} flows and the bearer-token
-- validation in /api/mcp/image.
--
-- All three tables are server-only (service role). RLS denies anon access
-- to keep tokens, codes, and client records out of the public REST API.

create table if not exists public.mcp_oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_secret text,                   -- null for public clients (claude.ai uses PKCE only)
  client_name text,
  redirect_uris text[] not null,
  token_endpoint_auth_method text not null default 'none',
  grant_types text[] not null default array['authorization_code','refresh_token'],
  scope text,
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_oauth_codes (
  code text primary key,
  client_id text not null,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null,  -- "S256" only
  scope text,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists mcp_oauth_codes_expires_idx
  on public.mcp_oauth_codes (expires_at);

create table if not exists public.mcp_oauth_tokens (
  access_token text primary key,
  refresh_token text unique,
  client_id text not null,
  scope text,
  expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists mcp_oauth_tokens_refresh_idx
  on public.mcp_oauth_tokens (refresh_token) where refresh_token is not null;
create index if not exists mcp_oauth_tokens_expires_idx
  on public.mcp_oauth_tokens (expires_at) where not revoked;

alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_oauth_tokens enable row level security;

-- Block all anon access; the OAuth route handlers go through service role.
drop policy if exists "mcp_oauth_clients_no_anon" on public.mcp_oauth_clients;
drop policy if exists "mcp_oauth_codes_no_anon" on public.mcp_oauth_codes;
drop policy if exists "mcp_oauth_tokens_no_anon" on public.mcp_oauth_tokens;
create policy "mcp_oauth_clients_no_anon" on public.mcp_oauth_clients for all using (false) with check (false);
create policy "mcp_oauth_codes_no_anon" on public.mcp_oauth_codes for all using (false) with check (false);
create policy "mcp_oauth_tokens_no_anon" on public.mcp_oauth_tokens for all using (false) with check (false);
