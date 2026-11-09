/**
 * Precomputed responses for the DAD's slow tabs (table dad_cache, migration
 * 0106). The slow part of those tabs was never Postgres: it was recomputing
 * from tens of thousands of raw rows on every visit, behind a 5-minute
 * in-memory cache that died with each serverless instance. Now:
 *
 *   - fresh  (younger than freshMs)  -> served straight from the table
 *   - stale  (younger than maxStaleMs) -> served at once, recomputed in the
 *     background (waitUntil), so the next load is fresh
 *   - missing / too old / ?fresh=1   -> computed now, saved, served
 *
 * The /api/cron/warm-cache job (pg_cron, every 10 minutes) recomputes every
 * key so nobody lands on a stale or cold entry after a quiet night.
 *
 * Payloads keep their own generatedAt where they have one, so a page that says
 * "updated 4 min ago" stays honest. A failed recompute never throws away a
 * good cached copy.
 */
import { waitUntil } from "@vercel/functions";
import { SUPABASE_URL } from "@/lib/supabase";

const SERVICE_ROLE =
  process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export interface CachePolicy {
  /** Serve without recomputing while younger than this. */
  freshMs: number;
  /** Serve stale (and refresh in the background) up to this age. */
  maxStaleMs: number;
}

export const MIN = 60_000;
export const HOUR = 60 * MIN;

/** Overview polls every 2 minutes; everything else changes a few times a day. */
export const POLICY = {
  live: { freshMs: 90_000, maxStaleMs: 12 * HOUR },
  daily: { freshMs: 10 * MIN, maxStaleMs: 36 * HOUR },
} satisfies Record<string, CachePolicy>;

export interface CacheMeta {
  key: string;
  /** When this payload was computed. */
  computedAt: string;
  /** "fresh" | "stale" (refreshing in the background) | "computed" (just now) */
  state: "fresh" | "stale" | "computed";
}

interface Row {
  key: string;
  payload: unknown;
  computed_at: string;
}

function headers(extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function readRow(key: string): Promise<Row | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dad_cache?select=key,payload,computed_at&key=eq.${encodeURIComponent(key)}&limit=1`,
      { headers: headers(), cache: "no-store" },
    );
    if (!res.ok) return null; // table missing or DB hiccup: behave as a miss
    const rows = (await res.json()) as Row[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function writeRow(key: string, payload: unknown, ms: number): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/dad_cache?on_conflict=key`, {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify([{ key, payload, computed_at: new Date().toISOString(), compute_ms: ms }]),
      cache: "no-store",
    });
  } catch {
    // a cache write failing must never fail the request
  }
}

/** One recompute per key per instance at a time. */
const inflight = new Map<string, Promise<unknown>>();

async function compute<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = (async () => {
    const t0 = Date.now();
    const value = await fn();
    await writeRow(key, value, Date.now() - t0);
    return value;
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

/**
 * The cached payload for `key`, recomputing per the policy. `force` (the
 * page's Refresh button, ?fresh=1) always recomputes.
 */
export async function cached<T>(
  key: string,
  policy: CachePolicy,
  fn: () => Promise<T>,
  opts: { force?: boolean } = {},
): Promise<{ value: T; meta: CacheMeta }> {
  const row = opts.force ? null : await readRow(key);
  const age = row ? Date.now() - Date.parse(row.computed_at) : Infinity;

  if (row && age < policy.freshMs) {
    return { value: row.payload as T, meta: { key, computedAt: row.computed_at, state: "fresh" } };
  }
  if (row && age < policy.maxStaleMs) {
    waitUntil(compute(key, fn).catch(() => undefined));
    return { value: row.payload as T, meta: { key, computedAt: row.computed_at, state: "stale" } };
  }
  try {
    const value = await compute(key, fn);
    return { value, meta: { key, computedAt: new Date().toISOString(), state: "computed" } };
  } catch (e) {
    // Too old to serve on its own, but better than an error page.
    if (row) return { value: row.payload as T, meta: { key, computedAt: row.computed_at, state: "stale" } };
    throw e;
  }
}

/** Recompute and save, ignoring the cache (the warm job). */
export async function warm<T>(key: string, fn: () => Promise<T>): Promise<number> {
  const t0 = Date.now();
  await compute(key, fn);
  return Date.now() - t0;
}

/** ?fresh=1 on a request: skip the cache. */
export function wantsFresh(req: Request): boolean {
  return new URL(req.url).searchParams.get("fresh") === "1";
}

/** Drop every cached key starting with `prefix`, after a write changes the data. */
export async function invalidate(prefix: string): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/dad_cache?key=like.${encodeURIComponent(prefix)}*`, {
      method: "DELETE",
      headers: headers(),
      cache: "no-store",
    });
  } catch {
    // worst case the tab shows the old numbers until the next warm run
  }
}
