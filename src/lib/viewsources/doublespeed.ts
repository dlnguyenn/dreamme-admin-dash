/**
 * Doublespeed view source — https://app.doublespeed.ai/api/v1
 *
 * Only two endpoints matter here:
 *   GET /api/v1/accounts                    the fleet + statuses
 *   GET /api/v1/posts?status=posted&...     posts with stats.{views,likes,comments}
 *
 * `stats.views` is a LIFETIME total; the API has no daily series and no
 * per-day endpoint, so the sync cron snapshots these into social_post_views
 * and socialViews.ts diffs consecutive days to get views-gained-per-day.
 *
 * Note `stats` carries no share count — the MCP surface exposed one, this REST
 * API does not. Shares stay null rather than being invented.
 */
import {
  firstLine,
  toPlatform,
  type SourceAccount,
  type SourcePost,
  type ViewSource,
} from "./types";

const BASE = (process.env.DOUBLESPEED_API_BASE ?? "https://app.doublespeed.ai").replace(/\/+$/, "");
const KEY = process.env.DOUBLESPEED_API_KEY ?? "";

/** Documented maximum. Fewer, larger pages = fewer round trips. */
const PAGE_SIZE = 100;
/** Safety valve so a pagination bug can't spin forever. */
const MAX_PAGES = 60;

interface DsAccount {
  id: string;
  username: string;
  name: string | null;
  status: string | null;
  account_type: string | null;
  created_at: string;
}

interface DsPost {
  id: string;
  status: string;
  post_time: string | null;
  succeeded_at: string | null;
  title: string | null;
  public_post_url: string | null;
  delete_requested: boolean;
  account: { username: string | null; account_type: string | null } | null;
  stats: { views?: number; likes?: number; comments?: number } | null;
}

interface DsPostsPage {
  ok: boolean;
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
  posts: DsPost[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    // Never echo the key, and cap the body — vendor errors can be HTML.
    throw new Error(
      `Doublespeed ${res.status} on ${path.split("?")[0]}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return res.json() as Promise<T>;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function doublespeedConfigured(): boolean {
  return KEY !== "";
}

/**
 * Raw fleet reads for the Overview's queue-coverage panel.
 *
 * Deliberately separate from the ViewSource mapping above: that shape drops
 * everything the view sync doesn't need (gender, status, scheduled posts),
 * and coverage needs exactly those.
 */
export async function dsAccounts(): Promise<
  {
    id: string;
    username: string;
    account_type: string | null;
    gender: string | null;
    status: string | null;
  }[]
> {
  const body = await get<{ ok: boolean; accounts: DsAccount[] }>("/api/v1/accounts");
  return (body.accounts ?? []).map((a) => ({
    id: a.id,
    username: a.username,
    account_type: a.account_type,
    // `gender` is the only grouping signal the REST API exposes — the richer
    // account_groups field is MCP-only. See lib/queueCoverage.ts.
    gender: (a as { gender?: string | null }).gender ?? null,
    status: a.status,
  }));
}

export async function dsPosts(
  status: "scheduled" | "posted",
  dateFrom?: string,
): Promise<
  {
    status: string | null;
    post_time: string | null;
    account: { username: string | null; account_type: string | null } | null;
  }[]
> {
  const out: DsPost[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= 10) {
    const body = await get<DsPostsPage>(
      `/api/v1/posts?status=${status}&page_size=${PAGE_SIZE}&page=${page}` +
        (dateFrom ? `&date_from=${dateFrom}` : ""),
    );
    totalPages = Number(body.total_pages) || 1;
    const rows = body.posts ?? [];
    if (rows.length === 0) break;
    out.push(...rows);
    page++;
  }
  return out.map((p) => ({
    status: p.status,
    post_time: p.post_time ?? p.succeeded_at,
    account: p.account,
  }));
}

export const doublespeedSource: ViewSource = {
  key: "doublespeed",

  configured() {
    return KEY !== "";
  },

  async listAccounts(): Promise<SourceAccount[]> {
    const body = await get<{ ok: boolean; accounts: DsAccount[] }>("/api/v1/accounts");
    const out: SourceAccount[] = [];
    for (const a of body.accounts ?? []) {
      const platform = toPlatform(a.account_type);
      // An unrecognised platform is dropped rather than guessed — a wrong
      // platform would put the account in the wrong bucket silently.
      if (!platform || !a.username) continue;
      out.push({
        externalId: a.id,
        handle: a.username,
        platform,
        status: a.status,
      });
    }
    return out;
  },

  async listPosts(since: Date): Promise<SourcePost[]> {
    const out: SourcePost[] = [];
    const seen = new Set<string>();
    let page = 1;
    let totalPages = 1;

    // status=posted only: scheduled and draft posts have no views to record.
    // date_from bounds the pull to the window we actually chart.
    while (page <= totalPages && page <= MAX_PAGES) {
      const body = await get<DsPostsPage>(
        `/api/v1/posts?status=posted&page_size=${PAGE_SIZE}&page=${page}` +
          `&date_from=${isoDate(since)}`,
      );
      totalPages = Number(body.total_pages) || 1;

      for (const p of body.posts ?? []) {
        const platform = toPlatform(p.account?.account_type);
        if (!platform || !p.id) continue;
        // Paging a list that is being written to can repeat a row across page
        // boundaries; the upsert would tolerate it but the counts would lie.
        if (seen.has(p.id)) continue;
        seen.add(p.id);

        out.push({
          sourcePostId: p.id,
          handle: p.account?.username ?? null,
          platform,
          postUrl: p.public_post_url,
          // succeeded_at is when it actually went live; post_time is the slot.
          postedAt: p.succeeded_at ?? p.post_time,
          hook: firstLine(p.title),
          views: num(p.stats?.views),
          likes: num(p.stats?.likes),
          comments: num(p.stats?.comments),
          shares: null,
        });
      }

      if ((body.posts ?? []).length === 0) break;
      page++;
    }

    return out;
  },
};
