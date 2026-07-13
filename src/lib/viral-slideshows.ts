/**
 * Shared server-side logic for the Viral Slideshows tool. Both the
 * single-URL route and the profile-top-N route funnel through
 * `saveNormalized` so slide download, comment scraping, dedup, and the DB
 * insert stay in one place.
 *
 * Provider-agnostic: each scrape can come from ScrapeCreators (cheaper,
 * default when SCRAPECREATORS_API_KEY is set) or Apify (clockworks actors).
 * Set VIRAL_SLIDESHOW_PROVIDER=scrapecreators|apify to force one; on a
 * provider error the other is used as a fallback.
 *
 * Storage: each slide is re-hosted to Supabase under
 * `viral-slideshows/{id}/slide-NN-{short}.jpg` (TikTok CDN URLs expire).
 */

import {
  runTikTokCommentsScrape,
  runTikTokPostScrape,
  runTikTokScrape,
} from "@/lib/apify";
import {
  ApifyTikTokCommentSchema,
  ApifyTikTokItemSchema,
  type ApifyTikTokItem,
} from "@/lib/schemas/apify";
import {
  scConfigured,
  scPostDetail,
  scProfilePopularSlideshows,
  scTopComments,
} from "@/lib/scrapecreators-tiktok";
import { fetchToStorage } from "@/lib/storage";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

export const TOP_COMMENTS = 20;

type Provider = "scrapecreators" | "apify";

/** Selected provider: explicit env wins, else SC if keyed, else Apify. */
export function activeProvider(): Provider {
  const env = process.env.VIRAL_SLIDESHOW_PROVIDER?.toLowerCase();
  if (env === "scrapecreators" || env === "apify") return env;
  return scConfigured() ? "scrapecreators" : "apify";
}

export function sbHeaders() {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

export interface StoredComment {
  text: string;
  likes: number;
  username: string | null;
  created: string | null;
  pinned: boolean;
  reply_count: number;
}

/**
 * Provider-neutral view of a scraped post — everything the collect+store
 * pipeline needs, regardless of which scraper produced it.
 */
export interface NormalizedSlideshow {
  tiktokUrl: string;
  isSlideshow: boolean;
  slideUrls: string[];
  caption: string | null;
  author: string | null;
  playCount: number | null;
  diggCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  createdISO: string | null;
}

export type CollectStatus = "saved" | "duplicate" | "not_slideshow" | "error";

export interface CollectResult {
  status: CollectStatus;
  slideshow?: unknown;
  tiktokUrl: string;
  error?: string;
}

// --- Apify → normalized -------------------------------------------------------

function apifyItemToNormalized(
  item: ApifyTikTokItem,
  fallbackUrl: string,
): NormalizedSlideshow {
  const slideUrls: string[] = [];
  for (const s of item.slideshowImageLinks ?? []) {
    const u = s.downloadLink ?? s.tiktokLink ?? null;
    if (u) slideUrls.push(u);
  }
  return {
    tiktokUrl: item.webVideoUrl ?? fallbackUrl,
    isSlideshow: !!item.isSlideshow && slideUrls.length > 0,
    slideUrls,
    caption: (item.text ?? "").trim() || null,
    author: item.authorMeta?.name ?? null,
    playCount: item.playCount ?? null,
    diggCount: item.diggCount ?? null,
    commentCount: item.commentCount ?? null,
    shareCount: item.shareCount ?? null,
    createdISO: item.createTimeISO ?? null,
  };
}

async function apifyTopComments(
  postUrl: string,
  n: number,
): Promise<StoredComment[]> {
  const raw = await runTikTokCommentsScrape({ postUrl, topLevelComments: n });
  const parsed: StoredComment[] = [];
  for (const rec of raw) {
    const c = ApifyTikTokCommentSchema.safeParse(rec);
    if (!c.success) continue;
    const text = (c.data.text ?? "").trim();
    if (!text) continue;
    parsed.push({
      text,
      likes: c.data.diggCount ?? 0,
      username: c.data.uniqueId ?? null,
      created: c.data.createTimeISO ?? null,
      pinned: c.data.pinnedByAuthor ?? false,
      reply_count: c.data.replyCommentTotal ?? 0,
    });
  }
  parsed.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.likes - a.likes;
  });
  return parsed.slice(0, n);
}

// --- Provider-aware fetches (with cross-provider fallback) --------------------

/**
 * Top comments for a post, pinned-first then by likes desc. Best-effort:
 * returns [] on total failure so a comment hiccup never blocks a collect.
 */
export async function scrapeTopComments(
  postUrl: string,
  n: number = TOP_COMMENTS,
): Promise<StoredComment[]> {
  const provider = activeProvider();
  try {
    if (provider === "scrapecreators") {
      return await scTopComments(postUrl, n);
    }
    return await apifyTopComments(postUrl, n);
  } catch (e) {
    console.error(
      `[viral-slideshows] ${provider} comment scrape failed for ${postUrl}:`,
      e,
    );
    // Fall back to the other provider before giving up.
    try {
      return provider === "scrapecreators"
        ? await apifyTopComments(postUrl, n)
        : await scTopComments(postUrl, n);
    } catch {
      return [];
    }
  }
}

/** Single pasted post URL → normalized, via the active provider (fallback). */
async function fetchPostNormalized(
  tiktokUrl: string,
): Promise<NormalizedSlideshow | null> {
  const provider = activeProvider();
  const viaApify = async (): Promise<NormalizedSlideshow | null> => {
    const rawItems = await runTikTokPostScrape({ postUrls: [tiktokUrl] });
    if (!rawItems.length) return null;
    const parsed = ApifyTikTokItemSchema.safeParse(rawItems[0]);
    if (!parsed.success) return null;
    return apifyItemToNormalized(parsed.data, tiktokUrl);
  };
  try {
    return provider === "scrapecreators"
      ? await scPostDetail(tiktokUrl)
      : await viaApify();
  } catch (e) {
    console.error(`[viral-slideshows] ${provider} post fetch failed:`, e);
    try {
      return provider === "scrapecreators" ? await viaApify() : await scPostDetail(tiktokUrl);
    } catch {
      return null;
    }
  }
}

// --- Core save ----------------------------------------------------------------

/**
 * Canonicalize a TikTok post URL for dedup + storage. The same slideshow
 * can appear as `/photo/{id}?lang=en` (browser) or `/video/{id}` (scraper),
 * so we key on `@user` + numeric id and rebuild a single canonical
 * `/photo/{id}` form. Falls back to stripping query/fragment.
 */
export function canonicalTikTokUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const m = u.pathname.match(/@([A-Za-z0-9._]+)\/(?:photo|video)\/(\d+)/);
    if (m) return `https://www.tiktok.com/@${m[1]}/photo/${m[2]}`;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url.trim();
  }
}

async function slideshowExists(tiktokUrl: string): Promise<string | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/viral_slideshows?select=id&tiktok_url=eq.${encodeURIComponent(tiktokUrl)}&limit=1`,
    { headers: sbHeaders(), cache: "no-store" },
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{ id: string }>;
  return rows.length > 0 ? rows[0].id : null;
}

/**
 * Download all slides for one normalized post, scrape its top comments, and
 * insert a viral_slideshows row. Skips (status "duplicate") if the URL is
 * already collected, or "not_slideshow" if the post has no slide images.
 */
export async function saveNormalized(
  n: NormalizedSlideshow,
  rawUrl?: string,
): Promise<CollectResult> {
  const tiktokUrl = canonicalTikTokUrl(n.tiktokUrl || rawUrl || "");
  if (!n.isSlideshow || n.slideUrls.length === 0) {
    return { status: "not_slideshow", tiktokUrl };
  }

  const existingId = await slideshowExists(tiktokUrl);
  if (existingId) return { status: "duplicate", tiktokUrl };

  const id = crypto.randomUUID();
  const shortId = id.slice(0, 8);
  const slides: Array<{ image_url: string }> = [];
  for (let i = 0; i < n.slideUrls.length; i++) {
    const path = `viral-slideshows/${id}/slide-${String(i).padStart(2, "0")}-${shortId}.jpg`;
    const imageUrl = await fetchToStorage(n.slideUrls[i], path);
    slides.push({ image_url: imageUrl });
  }

  const comments = await scrapeTopComments(tiktokUrl);

  const insert = await fetch(`${SUPABASE_URL}/rest/v1/viral_slideshows`, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({
      id,
      tiktok_url: tiktokUrl,
      author_username: n.author,
      caption: n.caption ?? "",
      play_count: n.playCount,
      digg_count: n.diggCount,
      comment_count: n.commentCount,
      share_count: n.shareCount,
      post_created_at: n.createdISO,
      slide_count: slides.length,
      slides,
      comments,
    }),
  });
  if (!insert.ok) {
    throw new Error(
      `viral_slideshow insert failed: ${insert.status} ${await insert.text()}`,
    );
  }
  const rows = await insert.json();
  const slideshow = Array.isArray(rows) ? rows[0] : rows;
  return { status: "saved", slideshow, tiktokUrl };
}

/** Collect a single slideshow from a pasted post URL. */
export async function collectSlideshowFromUrl(
  tiktokUrl: string,
): Promise<CollectResult> {
  const norm = await fetchPostNormalized(tiktokUrl);
  if (!norm) {
    return {
      status: "error",
      tiktokUrl,
      error:
        "Scraper returned no data. Check the URL is a public TikTok post.",
    };
  }
  return saveNormalized(norm, tiktokUrl);
}

/** Normalize a pasted handle or profile URL to a bare TikTok username. */
export function normalizeProfile(input: string): string {
  let s = input.trim();
  const m = s.match(/tiktok\.com\/@([A-Za-z0-9._]+)/i);
  if (m) return m[1];
  s = s.replace(/^@/, "");
  return s;
}

export interface ProfileCollectSummary {
  profile: string;
  considered: number;
  saved: number;
  skipped: number;
  slideshows: unknown[];
}

/** A creator's most-popular posts as normalized slideshows (active provider). */
async function fetchProfileSlideshows(
  profile: string,
  limit: number,
): Promise<NormalizedSlideshow[]> {
  const provider = activeProvider();
  const viaApify = async (): Promise<NormalizedSlideshow[]> => {
    const rawItems = await runTikTokScrape({
      profiles: [profile],
      resultsPerPage: 50,
      profileSorting: "popular",
    });
    const out: NormalizedSlideshow[] = [];
    for (const rec of rawItems) {
      const parsed = ApifyTikTokItemSchema.safeParse(rec);
      if (!parsed.success) continue;
      const n = apifyItemToNormalized(parsed.data, "");
      if (n.isSlideshow) out.push(n);
    }
    out.sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0));
    return out.slice(0, limit);
  };
  try {
    return provider === "scrapecreators"
      ? await scProfilePopularSlideshows(profile, limit)
      : await viaApify();
  } catch (e) {
    console.error(`[viral-slideshows] ${provider} profile fetch failed:`, e);
    return provider === "scrapecreators" ? viaApify() : scProfilePopularSlideshows(profile, limit);
  }
}

/**
 * Scrape a creator's most-popular posts, keep the slideshows, and collect
 * the top `limit` by play count. Duplicates already in the library are
 * skipped, not re-downloaded.
 */
export async function collectTopSlideshowsFromProfile(
  profile: string,
  limit: number = 10,
): Promise<ProfileCollectSummary> {
  const top = await fetchProfileSlideshows(profile, limit);

  const saved: unknown[] = [];
  let skipped = 0;
  for (const n of top) {
    try {
      const result = await saveNormalized(n);
      if (result.status === "saved") saved.push(result.slideshow);
      else skipped++;
    } catch (e) {
      console.error(`[viral-slideshows] collect failed for ${n.tiktokUrl}:`, e);
      skipped++;
    }
  }

  return {
    profile,
    considered: top.length,
    saved: saved.length,
    skipped,
    slideshows: saved,
  };
}
