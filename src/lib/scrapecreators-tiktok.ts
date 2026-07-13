/**
 * ScrapeCreators TikTok provider for the Viral Slideshows tool — a cheaper
 * alternative to the Apify clockworks actors (1 credit/request). Normalizes
 * ScrapeCreators responses into the shared NormalizedSlideshow / StoredComment
 * shapes so the collect+store pipeline in viral-slideshows.ts stays
 * provider-agnostic.
 *
 * Endpoints (x-api-key auth; shapes verified live 2026-07-13):
 *   GET /v2/tiktok/video?url=                              → { aweme_detail }
 *   GET /v3/tiktok/profile/videos?handle=&sort_by=popular  → { aweme_list[] }
 *   GET /v1/tiktok/video/comments?url=&cursor=             → { comments[] }
 *
 * Slideshow posts are aweme_type 150 with image_post_info.images[]; each
 * slide's clean (no-watermark) URL is display_image.url_list[0].
 */
import type { NormalizedSlideshow, StoredComment } from "./viral-slideshows";

const SC_BASE = "https://api.scrapecreators.com";
const SC_KEY = process.env.SCRAPECREATORS_API_KEY ?? "";

export function scConfigured(): boolean {
  return !!SC_KEY;
}

// --- Minimal typed views of the SC response fields we read --------------------

interface ScImage {
  display_image?: { url_list?: string[] };
  owner_watermark_image?: { url_list?: string[] };
}
interface ScAweme {
  aweme_id?: string;
  aweme_type?: number;
  desc?: string;
  create_time?: number;
  statistics?: {
    play_count?: number;
    digg_count?: number;
    comment_count?: number;
    share_count?: number;
  };
  author?: { unique_id?: string };
  image_post_info?: { images?: ScImage[] };
}
interface ScComment {
  text?: string;
  digg_count?: number;
  create_time?: number;
  author_pin?: boolean;
  stick_position?: number;
  reply_comment_total?: number;
  user?: { unique_id?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scGet<T>(
  path: string,
  params: Record<string, string>,
  attempt = 0,
): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  let res: Response;
  try {
    res = await fetch(`${SC_BASE}${path}?${qs}`, {
      headers: { "x-api-key": SC_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
  } catch (e) {
    // Network error / timeout — retry with backoff, then give up.
    if (attempt < 3) {
      await sleep(500 * 2 ** attempt);
      return scGet<T>(path, params, attempt + 1);
    }
    throw e;
  }
  if (!res.ok) {
    // Transient throttle/5xx under burst load — back off and retry.
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(500 * 2 ** attempt);
      return scGet<T>(path, params, attempt + 1);
    }
    throw new Error(
      `ScrapeCreators ${path} failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

function unixToISO(t: unknown): string | null {
  const n = typeof t === "number" ? t : Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function awemeToNormalized(a: ScAweme): NormalizedSlideshow {
  const images = a.image_post_info?.images ?? [];
  const slideUrls: string[] = [];
  for (const im of images) {
    const u =
      im.display_image?.url_list?.[0] ??
      im.owner_watermark_image?.url_list?.[0] ??
      null;
    if (u) slideUrls.push(u);
  }
  const st = a.statistics ?? {};
  const author = a.author?.unique_id ?? null;
  const id = a.aweme_id ?? "";
  const tiktokUrl =
    author && id ? `https://www.tiktok.com/@${author}/photo/${id}` : "";
  return {
    platform: "tiktok",
    tiktokUrl,
    // aweme_type 150 == photo/slideshow post
    isSlideshow: a.aweme_type === 150 && slideUrls.length > 0,
    slideUrls,
    caption: (a.desc ?? "").trim() || null,
    author,
    playCount: st.play_count ?? null,
    diggCount: st.digg_count ?? null,
    commentCount: st.comment_count ?? null,
    shareCount: st.share_count ?? null,
    createdISO: unixToISO(a.create_time),
  };
}

/** Single post → normalized. Throws on HTTP error (caller may fall back). */
export async function scPostDetail(url: string): Promise<NormalizedSlideshow> {
  const d = await scGet<{ aweme_detail?: ScAweme }>("/v2/tiktok/video", { url });
  const a = d.aweme_detail ?? (d as ScAweme);
  const norm = awemeToNormalized(a);
  if (!norm.tiktokUrl) norm.tiktokUrl = url;
  return norm;
}

/**
 * A creator's most-popular slideshows, sorted by play count desc, top `limit`.
 * Paginates the popularity-sorted feed until it has enough slideshows.
 */
export async function scProfilePopularSlideshows(
  handle: string,
  limit: number,
  maxPages = 3,
): Promise<NormalizedSlideshow[]> {
  const out: NormalizedSlideshow[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = { handle, sort_by: "popular" };
    if (cursor) params.max_cursor = cursor;
    const d = await scGet<{
      aweme_list?: ScAweme[];
      has_more?: boolean | number;
      max_cursor?: number | string;
    }>("/v3/tiktok/profile/videos", params);
    for (const a of d.aweme_list ?? []) {
      const n = awemeToNormalized(a);
      if (n.isSlideshow) out.push(n);
    }
    if (out.length >= limit) break;
    if (!d.has_more) break;
    cursor = String(d.max_cursor ?? "");
    if (!cursor) break;
  }
  out.sort((x, y) => (y.playCount ?? 0) - (x.playCount ?? 0));
  return out.slice(0, limit);
}

/** One pass of the comment pager (no sort). See scTopComments for the API. */
async function scCommentsOnce(
  url: string,
  n: number,
  maxPages: number,
): Promise<StoredComment[]> {
  const acc: StoredComment[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = { url };
    if (cursor) params.cursor = cursor;
    const d = await scGet<{
      comments?: ScComment[];
      has_more?: boolean | number;
      cursor?: number | string;
    }>("/v1/tiktok/video/comments", params);
    for (const c of d.comments ?? []) {
      const text = (c.text ?? "").trim();
      if (!text) continue;
      acc.push({
        text,
        likes: c.digg_count ?? 0,
        username: c.user?.unique_id ?? null,
        created: unixToISO(c.create_time),
        pinned: !!(c.author_pin || c.stick_position),
        reply_count: c.reply_comment_total ?? 0,
      });
    }
    if (acc.length >= n * 2) break;
    if (!d.has_more) break;
    cursor = String(d.cursor ?? "");
    if (!cursor) break;
  }
  return acc;
}

/**
 * Top `n` comments for a post, pinned-first then by likes desc. Pulls a
 * couple pages (TikTok's default order is not by likes) and sorts locally.
 * Retries once if the first attempt returns empty (transient under burst).
 */
export async function scTopComments(
  url: string,
  n: number,
  maxPages = 2,
): Promise<StoredComment[]> {
  let acc = await scCommentsOnce(url, n, maxPages);
  if (acc.length === 0) {
    await sleep(700);
    acc = await scCommentsOnce(url, n, maxPages);
  }
  acc.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.likes - a.likes;
  });
  return acc.slice(0, n);
}
