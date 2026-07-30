/**
 * Facebook scraping wrappers for the clipper program. Bare fetch, no SDK,
 * same style as apify-instagram.ts. Reuses APIFY_KEY.
 *
 * FALLBACK PROVIDER. ScrapeCreators is primary (see scrapecreators-facebook.ts
 * and the dispatcher in facebookViews.ts) — it is ~20x cheaper and returns
 * discovery and views in one call. This path runs only when
 * CLIPPER_FB_PROVIDER=apify or SCRAPECREATORS_API_KEY is missing.
 *
 * Two actors:
 *   apify~facebook-posts-scraper                    — page URL → recent posts
 *     (discovery: find a clipper's new video posts on their page; $0.002/post)
 *   social_developer~facebook-playcount-scraper     — video/reel URLs → play_count
 *     (refresh: per-URL view counts. NOTE $0.004 PER RESULT — an earlier comment
 *      here claimed ~$0.00005/url, which is the actor-start fee, not the real
 *      cost. At the old 1,000-video cap that was ~$120/mo.)
 */
import { z } from "zod";

const APIFY_TOKEN = process.env.APIFY_KEY ?? "";
const POSTS_ACTOR = process.env.APIFY_FB_POSTS_ACTOR_ID ?? "apify~facebook-posts-scraper";
const PLAYCOUNT_ACTOR =
  process.env.APIFY_FB_PLAYCOUNT_ACTOR_ID ?? "social_developer~facebook-playcount-scraper";

export function apifyFacebookConfigured(): boolean {
  return !!APIFY_TOKEN;
}

async function runActor(actorId: string, input: unknown): Promise<unknown[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_KEY not set");
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${APIFY_TOKEN}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Apify run failed (${actorId}): ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

// --- page discovery (official posts scraper) --------------------------------

const PagePostSchema = z
  .object({
    postId: z.string().optional(),
    legacyId: z.string().optional(),
    url: z.string().optional(),
    topLevelUrl: z.string().optional(),
    text: z.string().nullable().optional(),
    time: z.string().optional(), // ISO timestamp
    timestamp: z.number().optional(), // unix seconds
    isVideo: z.boolean().optional(),
    // video posts carry one/both of these depending on post type
    viewsCount: z.number().nullable().optional(),
    playCount: z.number().nullable().optional(),
    media: z.array(z.object({ __typename: z.string().optional() }).passthrough()).optional(),
    error: z.string().optional(),
  })
  .passthrough();

export interface FacebookPageVideo {
  externalId: string;
  url: string;
  title: string | null;
  postedAt: string | null;
  /** views if the posts scraper happened to include them */
  views: number | null;
}

function looksLikeVideoPost(p: z.infer<typeof PagePostSchema>): boolean {
  if (p.isVideo) return true;
  if (p.viewsCount != null || p.playCount != null) return true;
  if (p.media?.some((m) => (m.__typename ?? "").toLowerCase().includes("video"))) return true;
  const u = (p.url ?? "").toLowerCase();
  return u.includes("/videos/") || u.includes("/reel/") || u.includes("/watch");
}

/**
 * One run per page. Returns only video/reel posts — the discovery leg of the
 * daily clipper sync.
 */
export async function discoverPageVideos(
  pageUrl: string,
  resultsLimit = 30,
): Promise<FacebookPageVideo[]> {
  const raw = await runActor(POSTS_ACTOR, {
    startUrls: [{ url: pageUrl }],
    resultsLimit,
  });
  const out: FacebookPageVideo[] = [];
  for (const record of raw) {
    const parsed = PagePostSchema.safeParse(record);
    if (!parsed.success) continue;
    const p = parsed.data;
    if (p.error || !looksLikeVideoPost(p)) continue;
    const url = p.url ?? p.topLevelUrl;
    const externalId = p.postId ?? p.legacyId ?? url;
    if (!url || !externalId) continue;
    const postedAt =
      p.time ?? (p.timestamp ? new Date(p.timestamp * 1000).toISOString() : null);
    out.push({
      externalId,
      url,
      title: p.text ? p.text.slice(0, 300) : null,
      postedAt,
      views: p.viewsCount ?? p.playCount ?? null,
    });
  }
  return out;
}

// --- per-URL play counts -----------------------------------------------------

const PlayCountSchema = z
  .object({
    url: z.string().optional(),
    original_url: z.string().optional(),
    video_id: z.string().nullable().optional(),
    play_count: z.number().nullable().optional(),
    status: z.string().optional(), // "ok" | error-ish strings
    error: z.string().optional(),
  })
  .passthrough();

export interface FacebookPlayCount {
  url: string;
  playCount: number | null;
  status: string;
}

/**
 * One batched run for all known video URLs — actor charges per start URL.
 */
export async function fetchPlayCounts(urls: string[]): Promise<FacebookPlayCount[]> {
  if (urls.length === 0) return [];
  const raw = await runActor(PLAYCOUNT_ACTOR, {
    startUrls: urls.map((url) => ({ url })),
  });
  const out: FacebookPlayCount[] = [];
  for (const record of raw) {
    const parsed = PlayCountSchema.safeParse(record);
    if (!parsed.success) continue;
    const p = parsed.data;
    const url = p.original_url ?? p.url;
    if (!url) continue;
    out.push({
      url,
      playCount: p.play_count ?? null,
      status: p.error ?? p.status ?? (p.play_count != null ? "ok" : "no_play_count"),
    });
  }
  return out;
}
