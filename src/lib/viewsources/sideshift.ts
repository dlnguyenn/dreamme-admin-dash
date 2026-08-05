/**
 * Sideshift view source — https://app.sideshift.app/api/v1
 *
 * Sideshift is NOT a second posting platform for our persona fleet, which is
 * what we assumed before seeing the API. It is a UGC creator marketplace: the
 * posts it reports are made by hired creators on their OWN accounts
 * (contractorName identifies the creator, not one of our handles). Its views
 * are therefore a genuinely separate reach channel, which is exactly why the
 * Overview splits by source rather than showing one total.
 *
 * Two traps this client works around, both verified live on 2026-08-05:
 *
 *  1. TIMESTAMPS ARE SECONDS, NOT MILLISECONDS. The docs state "All timestamps
 *     are Unix timestamps in milliseconds" and that is wrong for uploadedAt:
 *     1785878767 is 2026-08-04 read as seconds and 1970-01-21 read as ms.
 *     Trusting the docs would date every post to 1970 and drop all of them out
 *     of the 30-day window silently. tsToIso() detects the magnitude instead of
 *     believing either.
 *
 *  2. metrics-history is not a backfill. GET /posts/{id}/metrics-history looks
 *     like it hands us the daily series for free — it returns viewsDelta per
 *     day — but every post sampled came back with totalDataPoints: 1 and
 *     growth: null. It is one request per post (563 posts against a 100 req/min
 *     limit, so ~6 minutes) to obtain a single point we already have from the
 *     list endpoint. Revisit once Sideshift has accumulated real history; until
 *     then our own daily snapshot is the series, same as for Doublespeed.
 *
 * Auth is `x-api-key`, not a Bearer token. Requires an active subscription:
 * a lapsed one returns 402, not 401.
 */
import {
  toPlatform,
  type Platform,
  type SourceAccount,
  type SourcePost,
  type ViewSource,
} from "./types";

const BASE = (process.env.SIDESHIFT_API_BASE ?? "https://app.sideshift.app/api/v1").replace(
  /\/+$/,
  "",
);
const KEY = process.env.SIDESHIFT_API_KEY ?? "";

/** Documented maximum. */
const PAGE_SIZE = 100;
const MAX_PAGES = 40;

interface SsPost {
  id: string;
  title: string | null;
  platform: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  contractorName: string | null;
  uploadedAt: number | null;
}

interface SsPostsPage {
  data: SsPost[];
  page: number;
  total: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-api-key": KEY, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    // 402 means the subscription lapsed — worth reading in the cron output
    // rather than being buried as a generic failure.
    throw new Error(
      `Sideshift ${res.status} on ${path.split("?")[0]}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return res.json() as Promise<T>;
}

/**
 * Unix seconds or milliseconds -> ISO. The API documents ms and returns s, so
 * neither claim is trusted: anything below this bound is too small to be a
 * plausible recent date in ms and is therefore seconds.
 *
 * 1e11 ms is 1973; 1e11 s is the year 5138. No real value is ambiguous.
 */
export function tsToIso(v: number | null | undefined): string | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  const ms = v < 1e11 ? v * 1000 : v;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const sideshiftSource: ViewSource = {
  key: "sideshift",

  configured() {
    return KEY !== "";
  },

  /**
   * Empty by design. Sideshift's account dimension is creators, and a creator
   * is not a per-platform handle we own — the same person posts to TikTok and
   * Instagram under different accounts we never see. Inventing social_accounts
   * rows for them would corrupt the "N accounts we run" count on the Overview,
   * which is a Doublespeed-fleet concept. Posts still carry the creator name in
   * `handle` so a post is attributable.
   */
  async listAccounts(): Promise<SourceAccount[]> {
    return [];
  },

  async listPosts(since: Date): Promise<SourcePost[]> {
    const out: SourcePost[] = [];
    const seen = new Set<string>();
    const sinceMs = since.getTime();
    const fromDate = since.toISOString().slice(0, 10);

    let page = 1;
    let collected = 0;

    // Driven by how much we've actually collected against `total`, not by
    // assuming every page comes back exactly full — a short page mid-run would
    // otherwise either stop the walk early or skip a page's worth of posts.
    // An empty page always ends it, so a wrong `total` can't spin the loop.
    while (page <= MAX_PAGES) {
      const body = await get<SsPostsPage>(
        `/posts?limit=${PAGE_SIZE}&page=${page}&fromDate=${fromDate}`,
      );
      const total = Number(body.total) || 0;
      const rows = body.data ?? [];
      if (rows.length === 0) break;
      collected += rows.length;

      for (const p of rows) {
        const platform: Platform | null = toPlatform(p.platform);
        if (!platform || !p.id) continue;
        if (seen.has(String(p.id))) continue;
        seen.add(String(p.id));

        const postedAt = tsToIso(p.uploadedAt);
        // Belt and braces: fromDate should already bound this, but the
        // timestamp-unit bug means a server-side filter and our own reading of
        // the field could disagree. Drop anything outside the window we asked
        // for rather than charting it.
        if (postedAt && new Date(postedAt).getTime() < sinceMs) continue;

        out.push({
          sourcePostId: String(p.id),
          // The creator who made it, not an account we run.
          handle: p.contractorName,
          platform,
          // The list endpoint carries no permalink.
          postUrl: null,
          postedAt,
          hook: p.title ? p.title.split("\n")[0].trim().slice(0, 300) || null : null,
          views: num(p.views),
          likes: num(p.likes),
          comments: num(p.comments),
          shares: num(p.shares),
        });
      }

      if (collected >= total) break;
      page++;
    }

    return out;
  },
};
