/**
 * ScrapeCreators Facebook provider for the clipper program — the cheap path for
 * "what did this creator post, and how many views does it have".
 *
 * Replaces the two Apify actors (see apify-facebook.ts, kept as fallback):
 * the reels feed returns view counts *with* discovery, so one call per page
 * does both legs of the daily sync.
 *
 * Endpoints (x-api-key auth; shapes verified live 2026-07-30):
 *   GET /v1/facebook/profile/reels?url=&cursor=&next_page_id=
 *        → { reels[], cursor, next_page_id, credits_charged }
 *        10 reels per credit. reel: { post_id, video_id, url, view_count,
 *        creation_time (ISO), description }
 *   GET /v1/facebook/post?url=&cache_max_age=1d
 *        → { post_id, view_count, creation_time, description, ... }
 *        1 credit, free on cache hit. Used only for videos the reels feed
 *        doesn't cover (non-reel uploads, pages we don't track).
 *
 * Cost note: 1 credit ≈ $0.00188 (Freelance plan, $47/25k). The reels feed is
 * ~$0.0002/video vs Apify's $0.004/video playcount actor.
 *
 * Accuracy note: the reels feed reports Facebook's *public badge* count, which
 * is rounded for large numbers (104,000); /v1/facebook/post reports the exact
 * count (105,117). The badge is what the creator sees on their own post, so it
 * is the right number for their dashboard — but see NEVER-DECREASE handling in
 * the cron, since the two sources can disagree by a rounding step.
 */
import type { FacebookPageVideo } from "./apify-facebook";

const SC_BASE = "https://api.scrapecreators.com";
const SC_KEY = process.env.SCRAPECREATORS_API_KEY ?? "";

export function scFacebookConfigured(): boolean {
  return !!SC_KEY;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scGet<T>(
  path: string,
  params: Record<string, string>,
  attempt = 0,
): Promise<T> {
  if (!SC_KEY) throw new Error("SCRAPECREATORS_API_KEY not set");
  const qs = new URLSearchParams(params).toString();
  let res: Response;
  try {
    res = await fetch(`${SC_BASE}${path}?${qs}`, {
      headers: { "x-api-key": SC_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    if (attempt < 3) {
      await sleep(500 * 2 ** attempt);
      return scGet<T>(path, params, attempt + 1);
    }
    throw e;
  }
  if (!res.ok) {
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(500 * 2 ** attempt);
      return scGet<T>(path, params, attempt + 1);
    }
    // 402 = out of credits; surface it verbatim so the cron can report it.
    throw new Error(
      `ScrapeCreators ${path} failed: ${res.status} ${(await res.text()).slice(0, 300)}`,
    );
  }
  return (await res.json()) as T;
}

// --- URL normalization -------------------------------------------------------

/** Query params that actually identify a post — everything else is tracking. */
const MEANINGFUL_PARAMS = new Set(["v", "story_fbid", "id", "fbid"]);

/**
 * Canonicalize a Facebook URL so the same post always yields the same string.
 *
 * Facebook hands out the same video under many forms (m./web./mbasic. hosts,
 * `?__cft__[0]=`, `?fbclid=`, `?mibextid=`, trailing slashes). The view-refresh
 * join matches scraper output to DB rows by exact string equality, and
 * clipper_videos.url is globally unique — so without this, one post can occupy
 * several rows and silently fail to refresh.
 *
 * Returns the input trimmed if it isn't a parseable URL (caller validates).
 */
export function normalizeFacebookUrl(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }
  const host = u.hostname.toLowerCase().replace(/^(m|web|mbasic|business|free)\./, "www.");
  if (host === "facebook.com") {
    u.hostname = "www.facebook.com";
  } else if (host.endsWith("facebook.com")) {
    u.hostname = "www.facebook.com";
  } else {
    u.hostname = host; // fb.watch and friends keep their host
  }
  u.protocol = "https:";
  u.hash = "";
  u.port = "";

  // Keep only identifying params (e.g. /watch/?v=123 lives entirely in ?v).
  const kept = new URLSearchParams();
  for (const [k, v] of [...u.searchParams].sort(([a], [b]) => a.localeCompare(b))) {
    if (MEANINGFUL_PARAMS.has(k.toLowerCase()) && v) kept.set(k.toLowerCase(), v);
  }
  u.search = kept.toString();

  // Drop the trailing slash on non-root paths so /reel/123/ === /reel/123.
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }
  return u.toString();
}

// --- page reels (discovery + views in one call) ------------------------------

interface ScReel {
  post_id?: string;
  video_id?: string;
  id?: string;
  url?: string;
  view_count?: number | null;
  creation_time?: string;
  description?: string | null;
}
interface ScReelsPage {
  success?: boolean;
  reels?: ScReel[];
  cursor?: string | null;
  next_page_id?: string | null;
  credits_charged?: number;
}

function reelToVideo(r: ScReel): FacebookPageVideo | null {
  const url = r.url ? normalizeFacebookUrl(r.url) : "";
  const externalId = r.post_id ?? r.video_id ?? r.id ?? url;
  if (!url || !externalId) return null;
  const postedAt = r.creation_time ? new Date(r.creation_time) : null;
  return {
    externalId,
    url,
    title: r.description ? r.description.slice(0, 300) : null,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt.toISOString() : null,
    views: typeof r.view_count === "number" ? r.view_count : null,
  };
}

/**
 * A page's recent reels, newest first, with view counts. Costs 1 credit per
 * page of 10. `maxPages` bounds both cost and latency.
 */
export async function fetchPageReels(
  pageUrl: string,
  maxPages = 10,
): Promise<FacebookPageVideo[]> {
  const out: FacebookPageVideo[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let nextPageId: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = { url: pageUrl };
    if (cursor) params.cursor = cursor;
    if (nextPageId) params.next_page_id = nextPageId;

    const d = await scGet<ScReelsPage>("/v1/facebook/profile/reels", params);
    const reels = d.reels ?? [];
    if (reels.length === 0) break;

    for (const r of reels) {
      const v = reelToVideo(r);
      if (!v || seen.has(v.url)) continue;
      seen.add(v.url);
      out.push(v);
    }
    if (!d.next_page_id) break;
    cursor = d.cursor ?? undefined;
    nextPageId = d.next_page_id;
  }
  return out;
}

// --- single post (fallback for videos not in a page's reels feed) ------------

interface ScPost {
  post_id?: string;
  view_count?: number | null;
  creation_time?: string;
  description?: string | null;
}

export interface FacebookPostMetrics {
  url: string;
  views: number | null;
  /** "ok" or a short reason, written straight to clipper_videos.scrape_status */
  status: string;
}

/**
 * Exact view count for one video/reel/watch URL. `cache_max_age=1d` makes
 * same-day repeats free, so re-running the cron costs nothing extra.
 */
export async function fetchPostMetrics(url: string): Promise<FacebookPostMetrics> {
  const normalized = normalizeFacebookUrl(url);
  try {
    const d = await scGet<ScPost>("/v1/facebook/post", {
      url: normalized,
      cache_max_age: "1d",
    });
    const views = typeof d.view_count === "number" ? d.view_count : null;
    return { url: normalized, views, status: views == null ? "no_view_count" : "ok" };
  } catch (e) {
    return {
      url: normalized,
      views: null,
      status: (e as Error).message.slice(0, 120),
    };
  }
}

/**
 * Sequential-with-small-concurrency fan-out over per-post lookups. Kept modest
 * on purpose: this path is the expensive one (1 credit each) and only runs for
 * videos the reels feed didn't cover.
 */
export async function fetchPostMetricsBatch(
  urls: string[],
  concurrency = 4,
): Promise<FacebookPostMetrics[]> {
  const out: FacebookPostMetrics[] = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    const chunk = urls.slice(i, i + concurrency);
    out.push(...(await Promise.all(chunk.map((u) => fetchPostMetrics(u)))));
  }
  return out;
}
