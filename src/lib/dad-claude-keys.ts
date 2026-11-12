/**
 * Claude's own DAD sign-in keys (table dad_claude_keys, migration 0113).
 * Only the SHA-256 of a key is stored; the key itself is shown once, to the
 * script that created it, which keeps it in ~/.claude/dad.json.
 */
import { SUPABASE_URL } from "@/lib/supabase";
import { hashClaudeKey, looksLikeClaudeKey, newClaudeKey } from "@/lib/dad-session";

const SERVICE_ROLE =
  process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export interface ClaudeKeyRow {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const COLS = "id,label,created_at,last_used_at,revoked_at";

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("Supabase env missing");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { cache: "no-store", ...init });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function listClaudeKeys(): Promise<ClaudeKeyRow[]> {
  return rest<ClaudeKeyRow[]>(`dad_claude_keys?select=${COLS}&order=created_at.desc`, {
    headers: headers(),
  });
}

/** Creates a key and returns it once, with its row. */
export async function createClaudeKey(label: string): Promise<{ key: string; row: ClaudeKeyRow }> {
  const key = newClaudeKey();
  const rows = await rest<ClaudeKeyRow[]>(`dad_claude_keys?select=${COLS}`, {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify({ label: label.slice(0, 80), key_hash: hashClaudeKey(key) }),
  });
  return { key, row: rows[0] };
}

/** The live (not revoked) row for a key, or null. */
export async function findLiveClaudeKey(key: string | null | undefined): Promise<ClaudeKeyRow | null> {
  if (!looksLikeClaudeKey(key)) return null;
  const rows = await rest<ClaudeKeyRow[]>(
    `dad_claude_keys?select=${COLS}&key_hash=eq.${hashClaudeKey(key)}&revoked_at=is.null&limit=1`,
    { headers: headers() },
  );
  return rows[0] ?? null;
}

export async function isClaudeKeyLive(id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await rest<{ id: string }[]>(
    `dad_claude_keys?select=id&id=eq.${id}&revoked_at=is.null&limit=1`,
    { headers: headers() },
  );
  return rows.length > 0;
}

/** Records the one open sign-in link for a key (replacing any unused one). */
export async function openClaudeTicket(id: string, jti: string): Promise<void> {
  await rest(`dad_claude_keys?id=eq.${id}`, {
    method: "PATCH",
    headers: headers({ Prefer: "return=minimal" }),
    body: JSON.stringify({ ticket_jti: jti }),
  });
}

/**
 * Uses up a sign-in link: succeeds once, only while the key is not revoked
 * and the link is the newest one opened for it.
 */
export async function redeemClaudeTicket(id: string, jti: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[A-Za-z0-9_-]{8,64}$/.test(jti)) return false;
  const rows = await rest<{ id: string }[]>(
    `dad_claude_keys?id=eq.${id}&ticket_jti=eq.${jti}&revoked_at=is.null&select=id`,
    {
      method: "PATCH",
      headers: headers({ Prefer: "return=representation" }),
      body: JSON.stringify({ ticket_jti: null, last_used_at: new Date().toISOString() }),
    },
  );
  return rows.length > 0;
}

export async function revokeClaudeKey(id: string): Promise<ClaudeKeyRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await rest<ClaudeKeyRow[]>(`dad_claude_keys?id=eq.${id}&select=${COLS}`, {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify({ revoked_at: new Date().toISOString(), ticket_jti: null }),
  });
  return rows[0] ?? null;
}
