/**
 * Live post state for daily persona batches.
 *
 * The batch tables are written once by claude/scripts/publish-batch-to-dash.py
 * at publish time. `doublespeed_post_id` proves a post was handed to
 * Doublespeed; it says nothing about whether it is still queued, already out,
 * or failed. Reading it as current state is what made Overview report a
 * long-since-published batch as "9/9 QUEUED".
 *
 * This module refreshes the real state from the Doublespeed REST API and
 * stores it on slideshow_batch_posts. Design notes:
 *
 *  - Only rows whose state actually CHANGED are written. After the first pass a
 *    posted row stays posted, so steady-state cost is zero writes.
 *  - A row we could not find in the API is left ALONE rather than being marked
 *    missing. The API window is bounded by date_from, so absence is usually
 *    "older than the window", not "gone".
 *  - Every failure path is non-fatal to the caller. A dashboard panel that says
 *    "unknown" is fine; one that lies is not, and one that 500s is worse.
 */
import { SUPABASE_URL } from "@/lib/supabase";

const BASE = (
  process.env.DOUBLESPEED_API_BASE ?? "https://app.doublespeed.ai"
).replace(/\/+$/, "");
const KEY = process.env.DOUBLESPEED_API_KEY ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

/** Don't re-hit Doublespeed more than this often; Overview polls every 2 min. */
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;
/** How far back to look for posted rows. Batches are daily; 45d is generous. */
const DEFAULT_LOOKBACK_DAYS = 45;
const PAGE_SIZE = 100;
const MAX_PAGES = 40;

export interface BatchPostState {
  post_status: string | null;
  posted_at: string | null;
  public_post_url: string | null;
}

interface DsPost {
  id: string;
  status: string;
  post_time: string | null;
  succeeded_at: string | null;
  public_post_url: string | null;
}

interface DsPostsPage {
  ok: boolean;
  total_pages: number;
  posts: DsPost[];
}

interface StateRow {
  id: string;
  doublespeed_post_id: string | null;
  post_status: string | null;
  posted_at: string | null;
  public_post_url: string | null;
  state_synced_at: string | null;
}

export function batchStateConfigured(): boolean {
  return KEY !== "" && SUPABASE_URL !== "" && SERVICE_ROLE !== "";
}

function sbHeaders(extra?: Record<string, string>) {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function ds<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    // Never echo the key; vendor errors can be HTML, so cap the body.
    throw new Error(
      `Doublespeed ${res.status} on ${path.split("?")[0]}: ${(
        await res.text()
      ).slice(0, 200)}`,
    );
  }
  return res.json() as Promise<T>;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Page one status filter into a map keyed by Doublespeed post id.
 *
 * `status` accepts ONLY 'all' | 'scheduled' | 'posted'. Anything else is a hard
 * 400 ("Invalid enum value") that aborts the whole sync, so the union is
 * enforced here rather than trusted at the call site.
 */
async function collect(
  status: "all" | "scheduled" | "posted",
  since: Date,
  into: Map<string, BatchPostState>,
): Promise<void> {
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= MAX_PAGES) {
    const body = await ds<DsPostsPage>(
      `/api/v1/posts?status=${encodeURIComponent(status)}` +
        `&page_size=${PAGE_SIZE}&page=${page}&date_from=${isoDate(since)}`,
    );
    totalPages = Number(body.total_pages) || 1;
    const posts = body.posts ?? [];
    for (const p of posts) {
      if (!p.id) continue;
      into.set(p.id, {
        post_status: p.status ?? status,
        // succeeded_at is when it actually went live; post_time is only the slot.
        posted_at: p.succeeded_at ?? p.post_time ?? null,
        public_post_url: p.public_post_url ?? null,
      });
    }
    if (posts.length === 0) break;
    page++;
  }
}

/**
 * Refresh stored post state from Doublespeed.
 *
 * @returns how many rows changed, and whether the remote call was skipped
 *          because everything was already fresh.
 */
export async function syncBatchPostState(opts?: {
  maxAgeMs?: number;
  lookbackDays?: number;
  batchKey?: string;
}): Promise<{ ok: boolean; updated: number; skipped: boolean; error?: string }> {
  if (!batchStateConfigured()) {
    return { ok: false, updated: 0, skipped: true, error: "not configured" };
  }
  const maxAgeMs = opts?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const lookbackDays = opts?.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;

  try {
    const scope = opts?.batchKey
      ? `&batch_key=eq.${encodeURIComponent(opts.batchKey)}`
      : "";
    const rowsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/slideshow_batch_posts` +
        `?select=id,doublespeed_post_id,post_status,posted_at,public_post_url,state_synced_at` +
        `&doublespeed_post_id=not.is.null${scope}` +
        `&order=state_synced_at.asc.nullsfirst&limit=500`,
      { headers: sbHeaders(), cache: "no-store" },
    );
    if (!rowsRes.ok) {
      throw new Error(`rows read ${rowsRes.status}: ${await rowsRes.text()}`);
    }
    const rows = (await rowsRes.json()) as StateRow[];
    if (rows.length === 0) return { ok: true, updated: 0, skipped: true };

    // Freshness gate. A row that has never synced has state_synced_at null and
    // sorts first, so this only short-circuits when everything is genuinely new.
    const oldest = rows[0].state_synced_at;
    if (oldest && Date.now() - Date.parse(oldest) < maxAgeMs) {
      return { ok: true, updated: 0, skipped: true };
    }

    const since = new Date(Date.now() - lookbackDays * 86_400_000);
    const remote = new Map<string, BatchPostState>();
    // One 'all' pass covers both live states. An earlier version called
    // collect('draft') first to catch posts that had fallen back to draft; that
    // is not a value this API accepts, so it 400'd on every run and the catch
    // below swallowed it, leaving the sync writing nothing at all. Drafts are
    // simply not exposed here: 'all' over 45 days returns only 'posted' and
    // 'scheduled'. A post that never drains therefore shows as QUEUED forever,
    // which is the honest reading, and the stuck-queue check below is what
    // turns a stale QUEUED into something visible.
    await collect("all", since, remote);

    const now = new Date().toISOString();
    let updated = 0;

    for (const row of rows) {
      const id = row.doublespeed_post_id;
      if (!id) continue;
      const next = remote.get(id);
      // Not in the window: leave the stored state alone rather than inventing
      // a "missing" status. Absence here is usually age, not deletion.
      if (!next) continue;

      const changed =
        next.post_status !== row.post_status ||
        next.posted_at !== row.posted_at ||
        next.public_post_url !== row.public_post_url;

      // Always stamp state_synced_at so the freshness gate advances even when
      // nothing changed; otherwise a stable batch would re-hit the API forever.
      const patch: Record<string, unknown> = { state_synced_at: now };
      if (changed) {
        patch.post_status = next.post_status;
        patch.posted_at = next.posted_at;
        patch.public_post_url = next.public_post_url;
      }

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/slideshow_batch_posts?id=eq.${row.id}`,
        {
          method: "PATCH",
          headers: sbHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify(patch),
        },
      );
      if (!res.ok) {
        throw new Error(`patch ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      if (changed) updated++;
    }

    return { ok: true, updated, skipped: false };
  } catch (e) {
    // Non-fatal by design: the caller renders "unknown", not a wrong answer.
    return {
      ok: false,
      updated: 0,
      skipped: false,
      error: (e as Error).message,
    };
  }
}
