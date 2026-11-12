-- Claude's own sign-in keys for the DAD (replaces the shared team password
-- for Claude sessions). One row per computer. Only the SHA-256 of the key is
-- stored; the key lives in ~/.claude/dad.json on that computer. Setting
-- revoked_at locks that key out at once (src/middleware.ts checks it on every
-- API request made with a Claude session). Service-role only.

create table if not exists public.dad_claude_keys (
  id uuid primary key default gen_random_uuid(),
  label text not null default '',
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- The one sign-in link currently open for this key (single use).
  ticket_jti text,
  revoked_at timestamptz
);

comment on table public.dad_claude_keys is
  'DAD sign-in keys for Claude sessions (hash only). Service-role only.';

alter table public.dad_claude_keys enable row level security;
revoke all on public.dad_claude_keys from anon, authenticated;
