/**
 * Support Inbox — service-role PostgREST helpers against the INTERNAL
 * Supabase project (same per-file helper convention as clippers.ts).
 */
import { SUPABASE_URL } from "@/lib/supabase";
import type {
  SupportActionRow,
  SupportDraftRow,
  SupportMessageRow,
  SupportThreadRow,
} from "./types";

const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

export function supportDbConfigured(): boolean {
  return !!SUPABASE_URL && !!SERVICE_ROLE;
}

function headers(): Record<string, string> {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

export async function spGet<T>(path: string): Promise<T> {
  if (!supportDbConfigured()) throw new Error("Supabase env missing");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * POST insert. resolution:
 *  - "ignore"  → Prefer: resolution=ignore-duplicates (idempotent ingest)
 *  - "merge"   → Prefer: resolution=merge-duplicates (upsert)
 *  - undefined → plain insert
 * Returns inserted/merged rows (ignored duplicates are absent from the result).
 */
export async function spPost<T>(
  table: string,
  rows: unknown,
  opts?: { onConflict?: string; resolution?: "ignore" | "merge" },
): Promise<T[]> {
  if (!supportDbConfigured()) throw new Error("Supabase env missing");
  const qs = opts?.onConflict
    ? `?on_conflict=${encodeURIComponent(opts.onConflict)}`
    : "";
  const resolution =
    opts?.resolution === "ignore"
      ? "resolution=ignore-duplicates,"
      : opts?.resolution === "merge"
        ? "resolution=merge-duplicates,"
        : "";
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs}`, {
    method: "POST",
    headers: {
      ...headers(),
      Prefer: `${resolution}return=representation`,
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T[]>;
}

export async function spDelete(pathWithFilter: string): Promise<void> {
  if (!supportDbConfigured()) throw new Error("Supabase env missing");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathWithFilter}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export async function spPatch<T>(
  pathWithFilter: string,
  patch: unknown,
): Promise<T[]> {
  if (!supportDbConfigured()) throw new Error("Supabase env missing");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathWithFilter}`, {
    method: "PATCH",
    headers: { ...headers(), Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T[]>;
}

// ---------------------------------------------------------------------------
// Typed convenience wrappers

export async function getThread(id: string): Promise<SupportThreadRow | null> {
  const rows = await spGet<SupportThreadRow[]>(
    `support_threads?id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function getThreadMessages(
  threadId: string,
): Promise<SupportMessageRow[]> {
  return spGet<SupportMessageRow[]>(
    `support_messages?thread_id=eq.${encodeURIComponent(threadId)}&order=sent_at.asc`,
  );
}

export async function getThreadDrafts(
  threadId: string,
): Promise<SupportDraftRow[]> {
  return spGet<SupportDraftRow[]>(
    `support_drafts?thread_id=eq.${encodeURIComponent(threadId)}&order=generation.desc,variant.asc`,
  );
}

export async function getThreadActions(
  threadId: string,
): Promise<SupportActionRow[]> {
  return spGet<SupportActionRow[]>(
    `support_actions?thread_id=eq.${encodeURIComponent(threadId)}&order=created_at.desc`,
  );
}

/**
 * Every action taken for a user, across ALL their threads — a person who
 * emails twice must not get refunded twice, and the second thread has no
 * knowledge of the first. Falls back to thread scope when the thread has
 * no resolved account.
 */
export async function getActionsForUserOrThread(
  threadId: string,
  appUserId: string | null,
): Promise<SupportActionRow[]> {
  if (!appUserId) return getThreadActions(threadId);
  return spGet<SupportActionRow[]>(
    `support_actions?or=(app_user_id.eq.${encodeURIComponent(appUserId)},thread_id.eq.${encodeURIComponent(threadId)})&order=created_at.desc`,
  );
}

export async function patchThread(
  id: string,
  patch: Record<string, unknown>,
): Promise<SupportThreadRow | null> {
  const rows = await spPatch<SupportThreadRow>(
    `support_threads?id=eq.${encodeURIComponent(id)}`,
    { ...patch, updated_at: new Date().toISOString() },
  );
  return rows[0] ?? null;
}

export interface SupportCursorRow {
  id: string;
  uidvalidity: number | null;
  last_uid: number | null;
  last_seen_at: string | null;
  /** Gmail API historyId — text because it's an unsigned 64-bit value. */
  history_id?: string | null;
  /** last staleness warning for this cursor; cleared when it advances */
  alerted_at?: string | null;
  updated_at: string;
}

export async function getCursor(id: string): Promise<SupportCursorRow | null> {
  const rows = await spGet<SupportCursorRow[]>(
    `support_cursors?id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows[0] ?? null;
}

/**
 * PostgREST rejects a whole upsert when the payload names a column the table
 * doesn't have (PGRST204) — which is exactly what happens when a deploy lands
 * before its migration. That once froze the Gmail cursor for a day
 * (2026-08-06: alerted_at shipped in code while the db-migrate run died in a
 * GitHub outage). Cursor advance is the invariant ingestion cannot live
 * without, so on that specific error we drop the unknown column and retry —
 * losing optional metadata, never the cursor.
 */
const UNKNOWN_COLUMN = /Could not find the '([^']+)' column/;

export async function saveCursor(
  cursor: Omit<SupportCursorRow, "updated_at">,
): Promise<void> {
  const row: Record<string, unknown> = {
    ...cursor,
    updated_at: new Date().toISOString(),
  };
  // One strip per unknown column, bounded so a weird error can't loop forever.
  for (let attempt = 0; ; attempt++) {
    try {
      await spPost("support_cursors", [row], {
        onConflict: "id",
        resolution: "merge",
      });
      return;
    } catch (e) {
      const missing =
        e instanceof Error ? UNKNOWN_COLUMN.exec(e.message)?.[1] : null;
      if (!missing || !(missing in row) || missing === "id" || attempt >= 3) {
        throw e;
      }
      delete row[missing];
    }
  }
}

export async function logAction(
  entry: Omit<SupportActionRow, "id" | "created_at">,
): Promise<SupportActionRow> {
  const rows = await spPost<SupportActionRow>("support_actions", [entry]);
  return rows[0];
}

/**
 * File a support thread into the Feature Requests tab. Same table the
 * /api/ingest/feature-request route writes to; inserted here directly
 * because that route is token-gated and calling ourselves over HTTP just to
 * reach one INSERT would add a hop that can fail on its own.
 */
export async function createFeatureRequest(row: {
  title: string;
  description: string;
  submitter_email: string | null;
  status: "new";
}): Promise<{ id: string }> {
  const rows = await spPost<{ id: string }>("feature_requests", [row]);
  return rows[0];
}
