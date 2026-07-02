/**
 * Viral App Inspo — pipeline that finds SaaS/consumer-app content going
 * viral organically on TikTok (Instagram lands in phase 2).
 *
 * Two nets:
 *   watchlist — curated app brand accounts (app_watchlist table), scraped
 *               in profile mode; app name/category inherited from the row.
 *   hashtag   — discovery sweeps (#apptok etc.) gated by a Haiku
 *               classifier ("is this actually about an app?").
 *
 * Floor: 50k views (VIRAL_FLOOR). Every kept post gets one Haiku-vision
 * call (cover frame + caption) that emits format / hook type / on-screen
 * hook text / why-it-hit in a single pass, then the cover is re-hosted to
 * our bucket. Existing posts just get their engagement counts refreshed —
 * no re-billing.
 *
 * Reuses: apify-spy.ts (clockworks actor wrappers), schemas/apify.ts
 * (item parsing), storage.ts (re-hosting), growth-tools.ts structuredCall.
 */
import {
  runProfileScrape,
  runHashtagScrape,
  apifySpyConfigured,
} from "@/lib/apify-spy";
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
const SCRAPE_CONCURRENCY = 4;
/** Hard cap on new-post classifications per run (cost guard). */
const MAX_CLASSIFY_PER_RUN = 60;

/** Discovery hashtags — broad app-content nets, junk gated by the classifier. */
export const APP_DISCOVERY_HASHTAGS = ["apptok", "appsyouneed", "newapp", "bestapps"];

// --- types -------------------------------------------------------------------

export interface WatchlistRow {
  id: string;
  platform: "tiktok" | "instagram";
  handle: string;
  app_name: string;
  category: string | null;
  active: boolean;
}

interface SourceResult {
  source: "watchlist" | "hashtag";
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

function coverUrlOf(item: ApifyTikTokItem): string | null {
  return (
    item.videoMeta?.originalCoverUrl ??
    item.videoMeta?.coverUrl ??
    item.slideshowImageLinks?.[0]?.downloadLink ??
    item.slideshowImageLinks?.[0]?.tiktokLink ??
    null
  );
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
    app_name: { type: "string", description: "The app/product name if identifiable, else empty string." },
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
  item: ApifyTikTokItem;
  handle: string;
  known?: { app_name: string; category: string | null };
}): Promise<Classified> {
  const cover = coverUrlOf(params.item);
  const image = cover ? await fetchImageBase64(cover) : null;

  const knownNote = params.known
    ? `This post is from the official brand account of "${params.known.app_name}"${params.known.category ? ` (category: ${params.known.category})` : ""} — is_app_content is true and by_brand is true unless the post is clearly unrelated to the product.`
    : "Unknown source (hashtag discovery) — judge strictly whether this is really about a mobile app or SaaS product.";

  const content: Array<Record<string, unknown>> = [];
  if (image) {
    content.push({ type: "image", source: { type: "base64", media_type: image.mime, data: image.data } });
  }
  content.push({
    type: "text",
    text:
      `TikTok post by @${params.handle}\n` +
      `Views: ${params.item.playCount ?? "?"} · Likes: ${params.item.diggCount ?? "?"}\n` +
      `Caption: ${(params.item.text ?? "(none)").slice(0, 500)}\n` +
      (params.item.isSlideshow ? "This is a photo slideshow (image above is the first slide).\n" : "The image above is the video cover frame.\n") +
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

// --- the pipeline --------------------------------------------------------------

export async function scrapeViralApps(opts?: {
  /** Restrict to specific watchlist handles (testing / UI re-scrape). */
  handles?: string[];
  includeDiscovery?: boolean;
  resultsPerProfile?: number;
}): Promise<ScrapeSummary> {
  if (!apifySpyConfigured()) throw new Error("APIFY_KEY not set");

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
    `app_watchlist?select=id,platform,handle,app_name,category,active&platform=eq.tiktok&active=eq.true&limit=200`,
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

  interface Candidate {
    item: ApifyTikTokItem;
    handle: string;
    source: "watchlist" | "hashtag";
    sourceDetail: string;
    known?: { app_name: string; category: string | null };
  }
  const candidates: Candidate[] = [];

  // 3) watchlist profile scrapes (small concurrency pool)
  await pool(watchlist, SCRAPE_CONCURRENCY, async (w) => {
    const result: SourceResult = { source: "watchlist", detail: w.handle, fetched: 0, kept: 0 };
    try {
      const raw = await runProfileScrape({
        profile: w.handle,
        resultsPerPage: opts?.resultsPerProfile ?? PROFILE_RESULTS,
      });
      const { items } = parseApifyItems(raw);
      result.fetched = items.length;
      for (const item of items) {
        if ((item.playCount ?? 0) >= VIRAL_FLOOR && item.webVideoUrl) {
          candidates.push({
            item,
            handle: w.handle,
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

  // 4) discovery hashtags
  if (opts?.includeDiscovery !== false) {
    await pool(APP_DISCOVERY_HASHTAGS, 2, async (tag) => {
      const result: SourceResult = { source: "hashtag", detail: `#${tag}`, fetched: 0, kept: 0 };
      try {
        const raw = await runHashtagScrape({ hashtag: tag, resultsPerPage: HASHTAG_RESULTS });
        const { items } = parseApifyItems(raw);
        result.fetched = items.length;
        for (const item of items) {
          if ((item.playCount ?? 0) >= VIRAL_FLOOR && item.webVideoUrl) {
            candidates.push({
              item,
              handle: item.authorMeta?.name ?? "",
              source: "hashtag",
              sourceDetail: `#${tag}`,
            });
            result.kept++;
          }
        }
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
      }
      summary.sources.push(result);
    });
  }

  // 5) upsert: refresh existing, classify + insert new
  const seenThisRun = new Set<string>();
  let classified = 0;
  for (const c of candidates) {
    const url = c.item.webVideoUrl!;
    if (seenThisRun.has(url)) continue;
    seenThisRun.add(url);

    try {
      const existingId = existingByUrl.get(url);
      if (existingId) {
        await sbWrite("PATCH", `viral_app_posts?id=eq.${existingId}`, {
          view_count: c.item.playCount ?? 0,
          like_count: c.item.diggCount ?? 0,
          comment_count: c.item.commentCount ?? 0,
          share_count: c.item.shareCount ?? 0,
          last_scraped_at: new Date().toISOString(),
        });
        summary.refreshed++;
        continue;
      }

      if (classified >= MAX_CLASSIFY_PER_RUN) {
        summary.classify_capped++;
        continue;
      }
      classified++;
      const tags = await classifyPost({ item: c.item, handle: c.handle, known: c.known });
      if (!tags.is_app_content) {
        summary.rejected_not_app++;
        continue;
      }

      // Re-host the cover so the feed doesn't depend on TikTok CDN expiry.
      let thumb: string | null = null;
      const cover = coverUrlOf(c.item);
      if (cover) {
        try {
          const postId = c.item.id ?? url.split("/").pop() ?? String(Date.now());
          thumb = await fetchToStorage(cover, `viral-apps/tiktok/${postId}.jpg`);
        } catch {
          thumb = null; // cover expired — the row is still useful
        }
      }

      await sbWrite("POST", `viral_app_posts?on_conflict=post_url`, {
        platform: "tiktok",
        post_id: c.item.id ?? null,
        post_url: url,
        author_handle: c.handle || null,
        app_name: tags.app_name || null,
        app_category: tags.app_category || null,
        by_brand: tags.by_brand,
        source: c.source,
        source_detail: c.sourceDetail,
        posted_at: c.item.createTimeISO ?? null,
        view_count: c.item.playCount ?? 0,
        like_count: c.item.diggCount ?? 0,
        comment_count: c.item.commentCount ?? 0,
        share_count: c.item.shareCount ?? 0,
        caption: (c.item.text ?? "").slice(0, 2000) || null,
        thumbnail_url: thumb,
        hook_text: tags.hook_text || null,
        format: c.item.isSlideshow ? "slideshow" : tags.format,
        hook_type: tags.hook_type || null,
        why_it_hit: tags.why_it_hit || null,
        is_confirmed_app: true,
      });
      existingByUrl.set(url, "new");
      summary.new_posts++;
    } catch (e) {
      summary.errors.push({ post_url: url, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return summary;
}
