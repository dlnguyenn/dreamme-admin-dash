/**
 * Viral App Inspo — pipeline that finds SaaS/consumer-app content going
 * viral organically on TikTok + Instagram.
 *
 * Two nets per platform:
 *   watchlist — curated app brand accounts (app_watchlist table); app
 *               name/category inherited from the row.
 *   discovery — hashtag sweeps (TikTok) / keyword reel search (Instagram)
 *               gated by a Haiku classifier ("is this actually about an app?").
 *
 * Floor: 50k views (VIRAL_FLOOR). Every kept post gets one Haiku-vision
 * call (cover frame + caption) that emits format / hook type / on-screen
 * hook text / why-it-hit in a single pass, then the cover is re-hosted to
 * our bucket. Existing posts just get their engagement counts refreshed —
 * no re-billing.
 *
 * Reuses: apify-spy.ts (TikTok actor wrappers), apify-instagram.ts (IG
 * actors), schemas/apify.ts (TikTok item parsing), storage.ts (re-hosting),
 * growth-tools.ts structuredCall.
 */
import {
  runProfileScrape,
  runHashtagScrape,
  apifySpyConfigured,
} from "@/lib/apify-spy";
import {
  runInstagramReelScrape,
  runInstagramSearchReels,
  type InstagramReelItem,
  type InstagramSearchItem,
} from "@/lib/apify-instagram";
import { parseApifyItems, type ApifyTikTokItem } from "@/lib/schemas/apify";
import { fetchToStorage } from "@/lib/storage";
import { structuredCall } from "@/lib/growth-tools";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

export const VIRAL_FLOOR = 50_000;
const HAIKU = "claude-haiku-4-5-20251001";
const PROFILE_RESULTS = 12;
const HASHTAG_RESULTS = 30;
// Apify sync runs are ~30s each and purely I/O-bound — 8 in flight keeps a
// 34-account watchlist around ~2.5min (the 300s route budget bit us at 4).
const SCRAPE_CONCURRENCY = 8;
const CLASSIFY_CONCURRENCY = 3;
/** Hard cap on new-post classifications per run (cost guard). */
const MAX_CLASSIFY_PER_RUN = 60;
/** Only pull IG reels newer than this (evergreen-viral still ranks via views). */
const IG_NEWER_THAN = "12 months";

/** TikTok discovery hashtags — broad app-content nets, junk gated by the classifier. */
export const APP_DISCOVERY_HASHTAGS = ["apptok", "appsyouneed", "newapp", "bestapps"];
/** Instagram discovery keyword searches. */
export const IG_DISCOVERY_QUERIES = ["must have apps", "apps you need"];

/**
 * Read the "discovery sweep" toggle (viral_app_settings singleton). The
 * hashtag/keyword sweep runs unless a saved setting turns it off. Defaults
 * to enabled if the row/table is missing (e.g. before 0042 lands).
 */
export async function isDiscoveryEnabled(): Promise<boolean> {
  try {
    const rows = await sbSelect<{ discovery_enabled: boolean }>(
      `viral_app_settings?select=discovery_enabled&limit=1`,
    );
    return rows[0]?.discovery_enabled ?? true;
  } catch {
    return true;
  }
}

export type Platform = "tiktok" | "instagram";

// --- types -------------------------------------------------------------------

export interface WatchlistRow {
  id: string;
  platform: Platform;
  handle: string;
  app_name: string;
  category: string | null;
  active: boolean;
}

/** Platform-agnostic post shape both scrapers normalize into. */
interface NormalizedPost {
  platform: Platform;
  postId: string | null;
  url: string;
  author: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  caption: string;
  coverUrl: string | null;
  postedAtISO: string | null;
  isSlideshow: boolean;
}

interface SourceResult {
  platform: Platform;
  source: "watchlist" | "hashtag" | "search";
  detail: string;
  fetched: number;
  kept: number;
  error?: string;
}

export interface ScrapeSummary {
  floor: number;
  sources: SourceResult[];
  new_posts: number;
  refreshed: number;
  rejected_not_app: number;
  classify_capped: number;
  errors: Array<{ post_url: string; error: string }>;
}

interface Candidate {
  post: NormalizedPost;
  source: "watchlist" | "hashtag" | "search";
  sourceDetail: string;
  known?: { app_name: string; category: string | null };
}

// --- small helpers -----------------------------------------------------------

async function sbSelect<T>(path: string): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON) throw new Error("Supabase not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase read failed (${path.split("?")[0]}): ${res.status}`);
  return (await res.json()) as T[];
}

async function sbWrite(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("service role not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "resolution=merge-duplicates,return=minimal" : "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase write failed (${path.split("?")[0]}): ${res.status} ${await res.text()}`);
}

async function fetchImageBase64(url: string): Promise<{ data: string; mime: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    return { data: buf.toString("base64"), mime };
  } catch {
    return null;
  }
}

/** Run tasks with a small concurrency pool (Apify sync runs are slow-ish). */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// --- normalizers ---------------------------------------------------------------

function fromTikTok(item: ApifyTikTokItem): NormalizedPost | null {
  if (!item.webVideoUrl) return null;
  return {
    platform: "tiktok",
    postId: item.id ?? null,
    url: item.webVideoUrl,
    author: item.authorMeta?.name ?? "",
    views: item.playCount ?? 0,
    likes: item.diggCount ?? 0,
    comments: item.commentCount ?? 0,
    shares: item.shareCount ?? 0,
    caption: item.text ?? "",
    coverUrl:
      item.videoMeta?.originalCoverUrl ??
      item.videoMeta?.coverUrl ??
      item.slideshowImageLinks?.[0]?.downloadLink ??
      item.slideshowImageLinks?.[0]?.tiktokLink ??
      null,
    postedAtISO: item.createTimeISO ?? null,
    isSlideshow: item.isSlideshow === true,
  };
}

function fromReel(item: InstagramReelItem): NormalizedPost | null {
  if (item.error || !item.url) return null;
  return {
    platform: "instagram",
    postId: item.shortCode ?? item.id ?? null,
    url: item.url,
    author: item.ownerUsername ?? "",
    views: item.videoPlayCount ?? item.videoViewCount ?? 0,
    likes: item.likesCount ?? 0,
    comments: item.commentsCount ?? 0,
    shares: item.sharesCount ?? 0,
    caption: item.caption ?? "",
    coverUrl: item.displayUrl ?? null,
    postedAtISO: item.timestamp ?? null,
    isSlideshow: false,
  };
}

function fromSearchItem(item: InstagramSearchItem): NormalizedPost | null {
  if (!item.code) return null;
  return {
    platform: "instagram",
    postId: item.code,
    url: `https://www.instagram.com/reel/${item.code}/`,
    author: item.user?.username ?? "",
    views: item.play_count ?? item.ig_play_count ?? 0,
    likes: item.like_count ?? 0,
    comments: item.comment_count ?? 0,
    shares: item.share_count ?? 0,
    caption: item.caption?.text ?? "",
    coverUrl: item.thumbnail_url ?? item.image_versions?.items?.[0]?.url ?? null,
    postedAtISO: item.taken_at ? new Date(item.taken_at * 1000).toISOString() : null,
    isSlideshow: false,
  };
}

// --- classification ------------------------------------------------------------

const FORMATS = ["talking_head", "screen_recording", "meme", "skit", "text_overlay", "slideshow", "other"] as const;
const HOOK_TYPES = ["question", "confession", "stat", "demo", "pov", "story", "other"] as const;

const CLASSIFY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    is_app_content: {
      type: "boolean",
      description: "True if the post is about a mobile app or SaaS product (promoting, demoing, reviewing, or clearly made by an app brand).",
    },
    app_name: {
      type: "string",
      description:
        "The app/product name if the post centers on ONE identifiable app. Use 'Multiple (listicle)' when it rounds up several apps. Empty string only when truly unidentifiable.",
    },
    app_category: {
      type: "string",
      description: "Short category: health_fitness, glp1, wellness, productivity, finance, social, education, design, saas, consumer, other.",
    },
    by_brand: { type: "boolean", description: "True if posted by the app's own brand account (vs a user/creator/affiliate)." },
    format: { type: "string", enum: [...FORMATS] },
    hook_type: { type: "string", enum: [...HOOK_TYPES] },
    hook_text: { type: "string", description: "The on-screen overlay text visible in the cover frame, verbatim. Empty if none visible." },
    why_it_hit: {
      type: "string",
      description: "1-2 sentences: why this post likely went viral (hook mechanics, emotion, relatability, format). Empty if not app content.",
    },
  },
  required: ["is_app_content", "app_name", "app_category", "by_brand", "format", "hook_type", "hook_text", "why_it_hit"],
};

interface Classified {
  is_app_content: boolean;
  app_name: string;
  app_category: string;
  by_brand: boolean;
  format: string;
  hook_type: string;
  hook_text: string;
  why_it_hit: string;
}

function validateClassified(v: unknown): Classified {
  const o = v as Record<string, unknown>;
  const fmt = (FORMATS as readonly string[]).includes(String(o.format)) ? String(o.format) : "other";
  const hook = (HOOK_TYPES as readonly string[]).includes(String(o.hook_type)) ? String(o.hook_type) : "other";
  return {
    is_app_content: o.is_app_content === true,
    app_name: String(o.app_name ?? "").slice(0, 80),
    app_category: String(o.app_category ?? "other").slice(0, 40),
    by_brand: o.by_brand === true,
    format: fmt,
    hook_type: hook,
    hook_text: String(o.hook_text ?? "").slice(0, 300),
    why_it_hit: String(o.why_it_hit ?? "").slice(0, 500),
  };
}

async function classifyPost(params: {
  post: NormalizedPost;
  known?: { app_name: string; category: string | null };
}): Promise<Classified> {
  const { post } = params;
  const image = post.coverUrl ? await fetchImageBase64(post.coverUrl) : null;

  const knownNote = params.known
    ? `This post is from the official brand account of "${params.known.app_name}"${params.known.category ? ` (category: ${params.known.category})` : ""} — is_app_content is true and by_brand is true unless the post is clearly unrelated to the product.`
    : "Unknown source (discovery sweep) — judge strictly whether this is really about a mobile app or SaaS product.";

  const platformLabel = post.platform === "tiktok" ? "TikTok" : "Instagram Reel";
  const content: Array<Record<string, unknown>> = [];
  if (image) {
    content.push({ type: "image", source: { type: "base64", media_type: image.mime, data: image.data } });
  }
  content.push({
    type: "text",
    text:
      `${platformLabel} by @${post.author || "(unknown)"}\n` +
      `Views: ${post.views} · Likes: ${post.likes}\n` +
      `Caption: ${(post.caption || "(none)").slice(0, 500)}\n` +
      (post.isSlideshow ? "This is a photo slideshow (image above is the first slide).\n" : "The image above is the video cover frame.\n") +
      `\n${knownNote}\n\nClassify via emit_post_tags.`,
  });

  const { value } = await structuredCall<Classified>({
    model: HAIKU,
    system:
      "You classify viral social posts for an app-marketing inspiration feed. Be decisive. hook_text must be the literal on-screen overlay text from the image (empty when none). why_it_hit should name the persuasion mechanic, not restate the caption.",
    user: content,
    toolName: "emit_post_tags",
    toolDescription: "Emit the post's classification.",
    schema: CLASSIFY_SCHEMA,
    validate: validateClassified,
    maxTokens: 500,
  });

  // Watchlist posts inherit the known identity regardless of model output.
  if (params.known) {
    value.is_app_content = true;
    value.by_brand = true;
    value.app_name = params.known.app_name;
    if (params.known.category) value.app_category = params.known.category;
  }
  return value;
}

// --- collection legs -------------------------------------------------------------

async function collectTikTok(
  watchlist: WatchlistRow[],
  includeDiscovery: boolean,
  resultsPerProfile: number,
  summary: ScrapeSummary,
  candidates: Candidate[],
): Promise<void> {
  await pool(watchlist, SCRAPE_CONCURRENCY, async (w) => {
    const result: SourceResult = { platform: "tiktok", source: "watchlist", detail: w.handle, fetched: 0, kept: 0 };
    try {
      const raw = await runProfileScrape({ profile: w.handle, resultsPerPage: resultsPerProfile });
      const { items } = parseApifyItems(raw);
      result.fetched = items.length;
      for (const item of items) {
        const post = fromTikTok(item);
        if (post && post.views >= VIRAL_FLOOR) {
          candidates.push({
            post: { ...post, author: post.author || w.handle },
            source: "watchlist",
            sourceDetail: w.handle,
            known: { app_name: w.app_name, category: w.category },
          });
          result.kept++;
        }
      }
      await sbWrite("PATCH", `app_watchlist?id=eq.${w.id}`, {
        last_scraped_at: new Date().toISOString(),
        last_result_count: items.length,
      });
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
    }
    summary.sources.push(result);
  });

  if (includeDiscovery) {
    await pool(APP_DISCOVERY_HASHTAGS, 2, async (tag) => {
      const result: SourceResult = { platform: "tiktok", source: "hashtag", detail: `#${tag}`, fetched: 0, kept: 0 };
      try {
        const raw = await runHashtagScrape({ hashtag: tag, resultsPerPage: HASHTAG_RESULTS });
        const { items } = parseApifyItems(raw);
        result.fetched = items.length;
        for (const item of items) {
          const post = fromTikTok(item);
          if (post && post.views >= VIRAL_FLOOR) {
            candidates.push({ post, source: "hashtag", sourceDetail: `#${tag}` });
            result.kept++;
          }
        }
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
      }
      summary.sources.push(result);
    });
  }
}

async function collectInstagram(
  watchlist: WatchlistRow[],
  includeDiscovery: boolean,
  resultsPerProfile: number,
  summary: ScrapeSummary,
  candidates: Candidate[],
): Promise<void> {
  // Watchlist: ONE bulk actor run for all usernames (charged per reel, so
  // batching saves N-1 actor starts).
  if (watchlist.length > 0) {
    const byHandle = new Map(watchlist.map((w) => [w.handle.toLowerCase(), w]));
    try {
      const items = await runInstagramReelScrape({
        usernames: watchlist.map((w) => w.handle),
        resultsLimit: resultsPerProfile,
        newerThan: IG_NEWER_THAN,
      });
      // Attribute items back to handles for per-account result counts.
      const countByHandle = new Map<string, number>();
      for (const item of items) {
        const owner = (item.ownerUsername ?? "").toLowerCase();
        if (owner) countByHandle.set(owner, (countByHandle.get(owner) ?? 0) + 1);
      }
      for (const w of watchlist) {
        const key = w.handle.toLowerCase();
        const fetched = countByHandle.get(key) ?? 0;
        const result: SourceResult = { platform: "instagram", source: "watchlist", detail: w.handle, fetched, kept: 0 };
        summary.sources.push(result);
        await sbWrite("PATCH", `app_watchlist?id=eq.${w.id}`, {
          last_scraped_at: new Date().toISOString(),
          last_result_count: fetched,
        });
      }
      const resultByHandle = new Map(
        summary.sources
          .filter((s) => s.platform === "instagram" && s.source === "watchlist")
          .map((s) => [s.detail.toLowerCase(), s]),
      );
      for (const item of items) {
        const post = fromReel(item);
        if (!post) continue;
        const w = byHandle.get(post.author.toLowerCase());
        if (post.views >= VIRAL_FLOOR) {
          candidates.push({
            post,
            source: "watchlist",
            sourceDetail: w?.handle ?? post.author,
            known: w ? { app_name: w.app_name, category: w.category } : undefined,
          });
          const r = resultByHandle.get(post.author.toLowerCase());
          if (r) r.kept++;
        }
      }
    } catch (e) {
      summary.sources.push({
        platform: "instagram",
        source: "watchlist",
        detail: `(bulk: ${watchlist.length} accounts)`,
        fetched: 0,
        kept: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (includeDiscovery) {
    await pool(IG_DISCOVERY_QUERIES, 2, async (query) => {
      const result: SourceResult = { platform: "instagram", source: "search", detail: query, fetched: 0, kept: 0 };
      try {
        const items = await runInstagramSearchReels({ query, maxPages: 1 });
        result.fetched = items.length;
        for (const item of items) {
          const post = fromSearchItem(item);
          if (post && post.views >= VIRAL_FLOOR) {
            candidates.push({ post, source: "search", sourceDetail: query });
            result.kept++;
          }
        }
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
      }
      summary.sources.push(result);
    });
  }
}

// --- the pipeline --------------------------------------------------------------

export async function scrapeViralApps(opts?: {
  /** Restrict to specific watchlist handles (testing / UI re-scrape). */
  handles?: string[];
  /** Which platforms to scrape; defaults to both. */
  platforms?: Platform[];
  includeDiscovery?: boolean;
  resultsPerProfile?: number;
}): Promise<ScrapeSummary> {
  if (!apifySpyConfigured()) throw new Error("APIFY_KEY not set");

  const platforms = opts?.platforms?.length ? opts.platforms : (["tiktok", "instagram"] as Platform[]);
  // Explicit caller wins (the UI's single-handle re-scrape forces false);
  // otherwise the saved "discovery sweep" toggle decides.
  const includeDiscovery =
    typeof opts?.includeDiscovery === "boolean" ? opts.includeDiscovery : await isDiscoveryEnabled();
  const resultsPerProfile = opts?.resultsPerProfile ?? PROFILE_RESULTS;

  const summary: ScrapeSummary = {
    floor: VIRAL_FLOOR,
    sources: [],
    new_posts: 0,
    refreshed: 0,
    rejected_not_app: 0,
    classify_capped: 0,
    errors: [],
  };

  // 1) load the watchlist
  let watchlist = await sbSelect<WatchlistRow>(
    `app_watchlist?select=id,platform,handle,app_name,category,active&active=eq.true&limit=400`,
  );
  if (opts?.handles?.length) {
    const want = new Set(opts.handles.map((h) => h.toLowerCase()));
    watchlist = watchlist.filter((w) => want.has(w.handle.toLowerCase()));
  }

  // 2) existing posts (url -> id) so re-scrapes refresh instead of re-billing
  const existing = await sbSelect<{ id: string; post_url: string }>(
    `viral_app_posts?select=id,post_url&limit=10000`,
  );
  const existingByUrl = new Map(existing.map((p) => [p.post_url, p.id]));

  // 3) collect from both platforms concurrently (independent I/O)
  const candidates: Candidate[] = [];
  const legs: Promise<void>[] = [];
  if (platforms.includes("tiktok")) {
    legs.push(
      collectTikTok(
        watchlist.filter((w) => w.platform === "tiktok"),
        includeDiscovery,
        resultsPerProfile,
        summary,
        candidates,
      ),
    );
  }
  if (platforms.includes("instagram")) {
    legs.push(
      collectInstagram(
        watchlist.filter((w) => w.platform === "instagram"),
        includeDiscovery,
        resultsPerProfile,
        summary,
        candidates,
      ),
    );
  }
  await Promise.all(legs);

  // 4) upsert: refresh existing, classify + insert new (both pooled — the
  //    classify pass is the long pole on cold runs)
  const unique = new Map<string, Candidate>();
  for (const c of candidates) {
    if (!unique.has(c.post.url)) unique.set(c.post.url, c);
  }
  const all = [...unique.entries()];
  const toRefresh = all.filter(([url]) => existingByUrl.has(url));
  let toClassify = all.filter(([url]) => !existingByUrl.has(url));
  if (toClassify.length > MAX_CLASSIFY_PER_RUN) {
    summary.classify_capped = toClassify.length - MAX_CLASSIFY_PER_RUN;
    toClassify = toClassify.slice(0, MAX_CLASSIFY_PER_RUN);
  }

  await pool(toRefresh, 6, async ([url, c]) => {
    try {
      await sbWrite("PATCH", `viral_app_posts?id=eq.${existingByUrl.get(url)}`, {
        view_count: c.post.views,
        like_count: c.post.likes,
        comment_count: c.post.comments,
        share_count: c.post.shares,
        last_scraped_at: new Date().toISOString(),
      });
      summary.refreshed++;
    } catch (e) {
      summary.errors.push({ post_url: url, error: e instanceof Error ? e.message : String(e) });
    }
  });

  await pool(toClassify, CLASSIFY_CONCURRENCY, async ([url, c]) => {
    try {
      const tags = await classifyPost({ post: c.post, known: c.known });
      if (!tags.is_app_content) {
        summary.rejected_not_app++;
        return;
      }

      // Re-host the cover so the feed doesn't depend on CDN expiry.
      let thumb: string | null = null;
      if (c.post.coverUrl) {
        try {
          const postId = c.post.postId ?? url.split("/").filter(Boolean).pop() ?? String(Math.random()).slice(2);
          thumb = await fetchToStorage(c.post.coverUrl, `viral-apps/${c.post.platform}/${postId}.jpg`);
        } catch {
          thumb = null; // cover expired — the row is still useful
        }
      }

      await sbWrite("POST", `viral_app_posts?on_conflict=post_url`, {
        platform: c.post.platform,
        post_id: c.post.postId,
        post_url: url,
        author_handle: c.post.author || null,
        app_name: tags.app_name || null,
        app_category: tags.app_category || null,
        by_brand: tags.by_brand,
        source: c.source,
        source_detail: c.sourceDetail,
        posted_at: c.post.postedAtISO,
        view_count: c.post.views,
        like_count: c.post.likes,
        comment_count: c.post.comments,
        share_count: c.post.shares,
        caption: c.post.caption.slice(0, 2000) || null,
        thumbnail_url: thumb,
        hook_text: tags.hook_text || null,
        format: c.post.isSlideshow ? "slideshow" : tags.format,
        hook_type: tags.hook_type || null,
        why_it_hit: tags.why_it_hit || null,
        is_confirmed_app: true,
      });
      summary.new_posts++;
    } catch (e) {
      summary.errors.push({ post_url: url, error: e instanceof Error ? e.message : String(e) });
    }
  });

  return summary;
}
