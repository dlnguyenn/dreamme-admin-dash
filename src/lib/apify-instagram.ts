/**
 * Instagram scraping wrappers for Viral App Inspo. Bare fetch, no SDK,
 * same style as apify-spy.ts. Reuses APIFY_KEY.
 *
 * Two actors (verified via the Apify store, 99.6% success each):
 *   apify~instagram-reel-scraper           — bulk profile reels (watchlist)
 *   patient_discovery~instagram-search-reels — keyword discovery
 */
import { z } from "zod";

const APIFY_TOKEN = process.env.APIFY_KEY ?? "";
const REEL_ACTOR = process.env.APIFY_IG_REEL_ACTOR_ID ?? "apify~instagram-reel-scraper";
const SEARCH_ACTOR =
  process.env.APIFY_IG_SEARCH_ACTOR_ID ?? "patient_discovery~instagram-search-reels";

export function apifyInstagramConfigured(): boolean {
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

// --- profile reels (official actor) -------------------------------------------

const ReelItemSchema = z
  .object({
    id: z.string().optional(),
    shortCode: z.string().optional(),
    url: z.string().optional(),
    inputUrl: z.string().optional(),
    caption: z.string().nullable().optional(),
    timestamp: z.string().optional(),
    ownerUsername: z.string().optional(),
    displayUrl: z.string().optional(),
    videoPlayCount: z.number().nullable().optional(),
    videoViewCount: z.number().nullable().optional(),
    likesCount: z.number().nullable().optional(),
    commentsCount: z.number().nullable().optional(),
    sharesCount: z.number().nullable().optional(),
    // present on failed profiles instead of reel data
    error: z.string().optional(),
    errorDescription: z.string().optional(),
  })
  .passthrough();

export type InstagramReelItem = z.infer<typeof ReelItemSchema>;

export function parseReelItems(raw: unknown[]): { items: InstagramReelItem[]; failed: number } {
  const items: InstagramReelItem[] = [];
  let failed = 0;
  for (const record of raw) {
    const parsed = ReelItemSchema.safeParse(record);
    if (parsed.success) items.push(parsed.data);
    else failed++;
  }
  return { items, failed };
}

/**
 * One bulk run for the whole watchlist — the actor takes an array of
 * usernames and charges per reel, so batching saves N-1 actor starts.
 */
export async function runInstagramReelScrape(opts: {
  usernames: string[];
  resultsLimit?: number;
  newerThan?: string; // "YYYY-MM-DD" or relative like "12 months"
}): Promise<InstagramReelItem[]> {
  if (opts.usernames.length === 0) return [];
  const raw = await runActor(REEL_ACTOR, {
    username: opts.usernames,
    resultsLimit: opts.resultsLimit ?? 12,
    ...(opts.newerThan ? { onlyPostsNewerThan: opts.newerThan } : {}),
    skipPinnedPosts: false,
  });
  return parseReelItems(raw).items;
}

// --- keyword discovery ----------------------------------------------------------

const SearchItemSchema = z
  .object({
    id: z.string().optional(),
    code: z.string().optional(),
    play_count: z.number().nullable().optional(),
    ig_play_count: z.number().nullable().optional(),
    like_count: z.number().nullable().optional(),
    comment_count: z.number().nullable().optional(),
    share_count: z.number().nullable().optional(),
    taken_at: z.number().optional(),
    thumbnail_url: z.string().optional(),
    image_versions: z
      .object({
        items: z.array(z.object({ url: z.string().optional() }).passthrough()).optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    caption: z
      .object({ text: z.string().optional() })
      .passthrough()
      .nullable()
      .optional(),
    user: z
      .object({ username: z.string().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export type InstagramSearchItem = z.infer<typeof SearchItemSchema>;

export async function runInstagramSearchReels(opts: {
  query: string;
  maxPages?: number;
}): Promise<InstagramSearchItem[]> {
  const raw = await runActor(SEARCH_ACTOR, {
    query: opts.query,
    maxPages: opts.maxPages ?? 1,
  });
  const items: InstagramSearchItem[] = [];
  for (const record of raw) {
    const parsed = SearchItemSchema.safeParse(record);
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}
