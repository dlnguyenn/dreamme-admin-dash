/**
 * Shared server-side logic for the Viral Slideshows tool. Both the
 * single-URL route and the profile-top-10 route funnel through
 * `collectSlideshowFromItem` so slide download, comment scraping, dedup,
 * and the DB insert stay in one place.
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
import { fetchToStorage } from "@/lib/storage";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

export const TOP_COMMENTS = 20;

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

export type CollectStatus = "saved" | "duplicate" | "not_slideshow" | "error";

export interface CollectResult {
  status: CollectStatus;
  slideshow?: unknown;
  tiktokUrl: string;
  error?: string;
}

/**
 * Scrape the top comments for a post, sorted by likes desc. Best-effort:
 * returns [] on any failure so a comment hiccup never blocks a collect.
 */
export async function scrapeTopComments(
  postUrl: string,
  n: number = TOP_COMMENTS,
): Promise<StoredComment[]> {
  try {
    const raw = await runTikTokCommentsScrape({
      postUrl,
      topLevelComments: n,
    });
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
    // Pinned first, then by likes desc.
    parsed.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.likes - a.likes;
    });
    return parsed.slice(0, n);
  } catch (e) {
    console.error(`[viral-slideshows] comment scrape failed for ${postUrl}:`, e);
    return [];
  }
}

/**
 * Canonicalize a TikTok post URL for dedup + storage. The same slideshow
 * can appear as `/photo/{id}?lang=en` (browser) or `/video/{id}` (scraper
 * webVideoUrl), so we key on `@user` + numeric id and rebuild a single
 * canonical `/photo/{id}` form. Falls back to stripping query/fragment.
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
 * Download all slides for one scraped item, scrape its top comments, and
 * insert a viral_slideshows row. Skips (status "duplicate") if the URL is
 * already collected, or "not_slideshow" if the item has no slide images.
 */
export async function collectSlideshowFromItem(
  item: ApifyTikTokItem,
  rawTiktokUrl: string,
): Promise<CollectResult> {
  const tiktokUrl = canonicalTikTokUrl(rawTiktokUrl);
  const slideLinks = item.slideshowImageLinks ?? [];
  if (!item.isSlideshow || slideLinks.length === 0) {
    return { status: "not_slideshow", tiktokUrl };
  }

  const existingId = await slideshowExists(tiktokUrl);
  if (existingId) {
    return { status: "duplicate", tiktokUrl };
  }

  const id = crypto.randomUUID();
  const shortId = id.slice(0, 8);
  const slides: Array<{ image_url: string }> = [];
  for (let i = 0; i < slideLinks.length; i++) {
    const src = slideLinks[i].downloadLink ?? slideLinks[i].tiktokLink ?? null;
    if (!src) throw new Error(`Slide ${i} missing download URL from Apify`);
    const path = `viral-slideshows/${id}/slide-${String(i).padStart(2, "0")}-${shortId}.jpg`;
    const imageUrl = await fetchToStorage(src, path);
    slides.push({ image_url: imageUrl });
  }

  const comments = await scrapeTopComments(tiktokUrl);

  const caption = (item.text ?? "").trim();
  const authorUsername = item.authorMeta?.name ?? null;
  const postCreatedAt = item.createTimeISO ?? null;

  const insert = await fetch(`${SUPABASE_URL}/rest/v1/viral_slideshows`, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "return=representation" },
    body: JSON.stringify({
      id,
      tiktok_url: tiktokUrl,
      author_username: authorUsername,
      caption,
      play_count: item.playCount ?? null,
      digg_count: item.diggCount ?? null,
      comment_count: item.commentCount ?? null,
      share_count: item.shareCount ?? null,
      post_created_at: postCreatedAt,
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

/**
 * Collect a single slideshow from a pasted post URL. Wraps the actor call
 * + shape validation, then delegates to collectSlideshowFromItem.
 */
export async function collectSlideshowFromUrl(
  tiktokUrl: string,
): Promise<CollectResult> {
  const rawItems = await runTikTokPostScrape({ postUrls: [tiktokUrl] });
  if (!rawItems.length) {
    return {
      status: "error",
      tiktokUrl,
      error:
        "Scraper returned no items. Check the URL is a public TikTok post.",
    };
  }
  const parsed = ApifyTikTokItemSchema.safeParse(rawItems[0]);
  if (!parsed.success) {
    return {
      status: "error",
      tiktokUrl,
      error: "Scraper response did not match expected shape",
    };
  }
  return collectSlideshowFromItem(parsed.data, tiktokUrl);
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

/**
 * Scrape a creator's most-popular posts, keep the slideshows, and collect
 * the top `limit` by play count. Duplicates already in the library are
 * skipped, not re-downloaded.
 */
export async function collectTopSlideshowsFromProfile(
  profile: string,
  limit: number = 10,
  fetchDepth: number = 50,
): Promise<ProfileCollectSummary> {
  const rawItems = await runTikTokScrape({
    profiles: [profile],
    resultsPerPage: fetchDepth,
    profileSorting: "popular",
  });

  const slideshows: ApifyTikTokItem[] = [];
  for (const rec of rawItems) {
    const parsed = ApifyTikTokItemSchema.safeParse(rec);
    if (!parsed.success) continue;
    const it = parsed.data;
    if (it.isSlideshow && (it.slideshowImageLinks?.length ?? 0) > 0) {
      slideshows.push(it);
    }
  }
  slideshows.sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0));
  const top = slideshows.slice(0, limit);

  const saved: unknown[] = [];
  let skipped = 0;
  for (const item of top) {
    const tiktokUrl = item.webVideoUrl ?? null;
    if (!tiktokUrl) {
      skipped++;
      continue;
    }
    try {
      const result = await collectSlideshowFromItem(item, tiktokUrl);
      if (result.status === "saved") saved.push(result.slideshow);
      else skipped++;
    } catch (e) {
      console.error(`[viral-slideshows] collect failed for ${tiktokUrl}:`, e);
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
