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
  /** A post Dan deleted still comes back in the `all` filter. */
  delete_requested?: boolean;
  /** This IS the caption; the API has no separate caption field. */
  title?: string | null;
  account?: { username: string | null; account_type: string | null } | null;
}

/**
 * One post's live truth: the derived state plus the fields the REST API
 * actually returns. Everything the Overview needs to show a post it has never
 * been told about — see lib/morningDiscovery.ts.
 */
export interface LivePost {
  id: string;
  derived: "posted" | "scheduled" | "draft";
  username: string | null;
  accountType: string | null;
  /** The caption. */
  title: string | null;
  postTime: string | null;
  succeededAt: string | null;
  publicPostUrl: string | null;
  deleteRequested: boolean;
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
  into: Map<string, DsPost>,
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
      into.set(p.id, p);
    }
    if (posts.length === 0) break;
    page++;
  }
}

/** The stored shape, from a raw post. `fallback` is the filter it came from. */
function toState(p: DsPost, fallback: string): BatchPostState {
  return {
    post_status: p.status ?? fallback,
    // succeeded_at is when it actually went live; post_time is only the slot.
    posted_at: p.succeeded_at ?? p.post_time ?? null,
    public_post_url: p.public_post_url ?? null,
  };
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
    const raw = new Map<string, DsPost>();
    // One 'all' pass, and the post's own `status` field is stored verbatim —
    // which means a draft is recorded as "scheduled", because that is what the
    // field says. syncMorningPostState below does NOT do this; it derives the
    // real state from filter membership. The same fix applies here and would
    // stop a stuck draft reading as QUEUED (the b28/maya failure), but this
    // sync feeds a different panel and is left alone deliberately.
    await collect("all", since, raw);
    const remote = new Map<string, BatchPostState>();
    for (const [id, p] of raw) remote.set(id, toState(p, "all"));

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

/**
 * True live state for one post, derived from which status FILTERS return it.
 *
 * The `status` field on a post object is useless for this: a draft and a
 * queued post both report `status: "scheduled"`. But the filters partition
 * cleanly — measured 2026-08-08 over a 2-day window: all=128, scheduled=18,
 * posted=68, scheduled ∩ posted = 0, and the 42 in `all` alone were exactly
 * the posts the MCP surface reports as drafts.
 *
 * So membership, not the field, is the discriminator:
 *   in posted            -> posted
 *   else in scheduled    -> scheduled (genuinely queued, will publish itself)
 *   else in all          -> draft     (sitting there; needs a person)
 *   in none              -> null      (outside the window; caller leaves it alone)
 *
 * This supersedes the note on syncBatchPostState above, which concluded drafts
 * were invisible to this API. They are invisible to the *field*, not to the
 * *filters* — that pass was never run.
 */
async function collectDerived(since: Date): Promise<Map<string, LivePost>> {
  const one = async (s: "all" | "scheduled" | "posted") => {
    const m = new Map<string, DsPost>();
    await collect(s, since, m);
    return m;
  };
  const [all, scheduled, posted] = await Promise.all([
    one("all"),
    one("scheduled"),
    one("posted"),
  ]);

  const out = new Map<string, LivePost>();
  for (const [id, p] of all) {
    out.set(id, {
      id,
      derived: posted.has(id)
        ? "posted"
        : scheduled.has(id)
          ? "scheduled"
          : "draft",
      username: p.account?.username ?? null,
      accountType: p.account?.account_type ?? null,
      title: p.title ?? null,
      postTime: p.post_time ?? null,
      succeededAt: p.succeeded_at ?? null,
      publicPostUrl: p.public_post_url ?? null,
      deleteRequested: p.delete_requested === true,
    });
  }
  return out;
}

/**
 * The live post map, memoized briefly so the Overview's two consumers — the
 * morning sync and morning discovery — share ONE set of three paged pulls.
 *
 * Per-lambda-instance and read-only; nothing depends on it for correctness,
 * only for not fetching twice inside a single Overview build. Callers must not
 * mutate the returned map.
 */
let liveMemo: { key: string; at: number; value: Map<string, LivePost> } | null =
  null;
const LIVE_TTL_MS = 60_000;

export async function liveDoublespeedPosts(
  since: Date,
): Promise<Map<string, LivePost>> {
  const key = isoDate(since);
  if (liveMemo && liveMemo.key === key && Date.now() - liveMemo.at < LIVE_TTL_MS) {
    return liveMemo.value;
  }
  const value = await collectDerived(since);
  liveMemo = { key, at: Date.now(), value };
  return value;
}

/**
 * Same refresh for morning_posts (the daily routine posts on the FB/IG sets).
 *
 * Unlike syncBatchPostState this stores the DERIVED state above, so
 * post_status is the real live answer to "is this drafted or queued?" — and
 * it keeps up when Dan promotes a draft in the Doublespeed UI, which the
 * routine-recorded created_status never could.
 */
export async function syncMorningPostState(opts: {
  batchDate: string;
  maxAgeMs?: number;
  lookbackDays?: number;
  /** Share the caller's already-fetched map instead of pulling again. */
  live?: Map<string, LivePost>;
}): Promise<{ ok: boolean; updated: number; skipped: boolean; error?: string }> {
  if (!batchStateConfigured()) {
    return { ok: false, updated: 0, skipped: true, error: "not configured" };
  }
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const lookbackDays = opts.lookbackDays ?? 2;

  try {
    const rowsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/morning_posts` +
        `?select=id,doublespeed_post_id,post_status,posted_at,public_post_url,state_synced_at` +
        `&batch_date=eq.${encodeURIComponent(opts.batchDate)}` +
        `&doublespeed_post_id=not.is.null` +
        `&order=state_synced_at.asc.nullsfirst&limit=100`,
      { headers: sbHeaders(), cache: "no-store" },
    );
    if (!rowsRes.ok) {
      throw new Error(`rows read ${rowsRes.status}: ${await rowsRes.text()}`);
    }
    const rows = (await rowsRes.json()) as StateRow[];
    if (rows.length === 0) return { ok: true, updated: 0, skipped: true };

    const oldest = rows[0].state_synced_at;
    if (oldest && Date.now() - Date.parse(oldest) < maxAgeMs) {
      return { ok: true, updated: 0, skipped: true };
    }

    const since = new Date(Date.now() - lookbackDays * 86_400_000);
    const remote = opts.live ?? (await liveDoublespeedPosts(since));

    const now = new Date().toISOString();
    let updated = 0;

    for (const row of rows) {
      const id = row.doublespeed_post_id;
      if (!id) continue;
      const live = remote.get(id);
      if (!live) continue;
      const next: BatchPostState = {
        post_status: live.derived,
        posted_at: live.succeededAt ?? live.postTime ?? null,
        public_post_url: live.publicPostUrl,
      };

      const changed =
        next.post_status !== row.post_status ||
        next.posted_at !== row.posted_at ||
        next.public_post_url !== row.public_post_url;

      const patch: Record<string, unknown> = { state_synced_at: now };
      if (changed) {
        patch.post_status = next.post_status;
        patch.posted_at = next.posted_at;
        patch.public_post_url = next.public_post_url;
      }

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/morning_posts?id=eq.${row.id}`,
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
    return {
      ok: false,
      updated: 0,
      skipped: false,
      error: (e as Error).message,
    };
  }
}
