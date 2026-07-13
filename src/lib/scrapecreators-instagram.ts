/**
 * ScrapeCreators Instagram provider for the Viral Slideshows tool. Mirrors
 * the TikTok provider but for Instagram carousels (the IG analog of a TikTok
 * slideshow). Normalizes into the shared NormalizedSlideshow / StoredComment
 * shapes so the collect+store pipeline stays platform-agnostic.
 *
 * Endpoints (x-api-key auth; shapes verified live 2026-07-13):
 *   GET /v2/instagram/user/posts?handle=&next_max_id=   → { items[] } (native)
 *   GET /v2/instagram/post?url=                          → single post
 *   GET /v2/instagram/post/comments?url=&cursor=         → { comments[] }
 *
 * A carousel is media_type 8 with carousel_media[]; each child's best image
 * is image_versions2.candidates[0].url. Counts come back as STRINGS.
 * Instagram has no popularity sort, so "top N" = fetch recent posts and rank
 * by like count locally.
 */
import type { NormalizedSlideshow, StoredComment } from "./viral-slideshows";

const SC_BASE = "https://api.scrapecreators.com";
const SC_KEY = process.env.SCRAPECREATORS_API_KEY ?? "";

const IG_CAROUSEL = 8; // media_type for a multi-image carousel post

export function igConfigured(): boolean {
  return !!SC_KEY;
}

// --- Minimal typed views of the SC/IG response fields we read -----------------

interface IgImageCandidate {
  url?: string;
}
interface IgMedia {
  media_type?: number;
  image_versions2?: { candidates?: IgImageCandidate[] };
}
interface IgPost {
  code?: string;
  shortcode?: string;
  media_type?: number;
  like_count?: number | string;
  comment_count?: number | string;
  play_count?: number | string;
  view_count?: number | string;
  taken_at?: number | string;
  created_at?: number | string;
  caption?: { text?: string } | string | null;
  user?: { username?: string };
  carousel_media?: IgMedia[];
  image_versions2?: { candidates?: IgImageCandidate[] };
}
interface IgComment {
  text?: string;
  comment_like_count?: number | string;
  child_comment_count?: number | string;
  created_at?: number | string;
  user?: { username?: string };
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

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toISO(t: unknown): string | null {
  if (t == null) return null;
  // IG comments return an ISO string; posts return a unix timestamp.
  if (typeof t === "string" && /[T:-]/.test(t) && Number.isNaN(Number(t))) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const n = num(t);
  if (!n || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function captionText(c: IgPost["caption"]): string | null {
  if (!c) return null;
  const t = typeof c === "string" ? c : c.text;
  return (t ?? "").trim() || null;
}

function bestImage(m: IgMedia): string | null {
  return m.image_versions2?.candidates?.[0]?.url ?? null;
}

function igToNormalized(p: IgPost): NormalizedSlideshow {
  const children = p.carousel_media ?? [];
  const slideUrls: string[] = [];
  for (const ch of children) {
    const u = bestImage(ch);
    if (u) slideUrls.push(u);
  }
  const code = p.code ?? p.shortcode ?? "";
  const author = p.user?.username ?? null;
  return {
    platform: "instagram",
    tiktokUrl: code ? `https://www.instagram.com/p/${code}/` : "",
    isSlideshow: p.media_type === IG_CAROUSEL && slideUrls.length > 0,
    slideUrls,
    caption: captionText(p.caption),
    author,
    playCount: num(p.play_count ?? p.view_count),
    diggCount: num(p.like_count),
    commentCount: num(p.comment_count),
    shareCount: null,
    createdISO: toISO(p.taken_at ?? p.created_at),
  };
}

/** Single IG post → normalized. Throws on HTTP error. */
export async function igPostDetail(url: string): Promise<NormalizedSlideshow> {
  const d = await scGet<IgPost>("/v2/instagram/post", { url });
  const norm = igToNormalized(d);
  if (!norm.tiktokUrl) norm.tiktokUrl = url;
  return norm;
}

/**
 * A creator's most-liked carousels: paginate recent posts, keep carousels,
 * rank by like count desc, take top `limit`. IG has no popular sort, so we
 * scan a deep window (~maxPages*12 posts) and rank within it — approximating
 * an all-time top-N for most creators. ~1 credit per page (12 posts).
 */
export async function igProfileTopCarousels(
  handle: string,
  limit: number,
  maxPages = 20,
): Promise<NormalizedSlideshow[]> {
  const out: NormalizedSlideshow[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = { handle };
    if (cursor) params.next_max_id = cursor;
    const d = await scGet<{
      items?: IgPost[];
      next_max_id?: string;
      more_available?: boolean;
    }>("/v2/instagram/user/posts", params);
    for (const p of d.items ?? []) {
      const n = igToNormalized(p);
      if (n.isSlideshow) out.push(n);
    }
    if (!d.more_available || !d.next_max_id) break;
    cursor = d.next_max_id;
  }
  out.sort((a, b) => (b.diggCount ?? 0) - (a.diggCount ?? 0));
  return out.slice(0, limit);
}

/** Top `n` comments for an IG post, by likes desc. */
async function igCommentsOnce(url: string, n: number, maxPages: number) {
  const acc: StoredComment[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = { url };
    if (cursor) params.cursor = cursor;
    const d = await scGet<{
      comments?: IgComment[];
      cursor?: string;
    }>("/v2/instagram/post/comments", params);
    for (const c of d.comments ?? []) {
      const text = (c.text ?? "").trim();
      if (!text) continue;
      acc.push({
        text,
        likes: num(c.comment_like_count) ?? 0,
        username: c.user?.username ?? null,
        created: toISO(c.created_at),
        pinned: false,
        reply_count: num(c.child_comment_count) ?? 0,
      });
    }
    if (acc.length >= n * 2) break;
    if (!d.cursor) break;
    cursor = d.cursor;
  }
  return acc;
}

export async function igTopComments(
  url: string,
  n: number,
  maxPages = 2,
): Promise<StoredComment[]> {
  // The comments endpoint occasionally returns an empty page under burst
  // load; retry once before concluding a post has no comments.
  let acc = await igCommentsOnce(url, n, maxPages);
  if (acc.length === 0) {
    await sleep(700);
    acc = await igCommentsOnce(url, n, maxPages);
  }
  acc.sort((a, b) => b.likes - a.likes);
  return acc.slice(0, n);
}
