/**
 * Hashtag-mode wrapper for the same clockworks~tiktok-scraper actor we
 * use for our personas in src/lib/apify.ts. Bare fetch, no SDK. The
 * actor accepts `hashtags: ["glp1"]` as an alternative to `profiles`.
 *
 * Reuses APIFY_KEY env var. No new vendor key required.
 */

const APIFY_TOKEN = process.env.APIFY_KEY ?? "";
const ACTOR_ID = process.env.APIFY_TIKTOK_ACTOR_ID ?? "clockworks~tiktok-scraper";

export function apifySpyConfigured(): boolean {
  return !!APIFY_TOKEN;
}

export async function runHashtagScrape(opts: {
  hashtag: string;
  resultsPerPage?: number;
}): Promise<unknown[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_KEY not set");
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
    ACTOR_ID,
  )}/run-sync-get-dataset-items`;
  const body = {
    hashtags: [opts.hashtag],
    resultsPerPage: opts.resultsPerPage ?? 30,
    shouldDownloadCovers: false,
    shouldDownloadVideos: false,
    shouldDownloadSlideshowImages: true,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${APIFY_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `Apify hashtag run failed (${opts.hashtag}): ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

/**
 * Free-text search query mode of the same actor. Same shape as
 * runHashtagScrape but uses the actor's `searchQueries` field instead
 * of `hashtags`. One query per call (separate Apify runs per query —
 * gives us independent per-query cost attribution and isolates failures).
 *
 * `sortByLikes` sorts search results by MOST_LIKED (a cheap charged
 * add-on) so a fixed result budget returns the top videos rather than a
 * random slice — most of them then clear our view floor instead of ~40%.
 */
export async function runSearchQueryScrape(opts: {
  query: string;
  resultsPerPage?: number;
  sortByLikes?: boolean;
}): Promise<unknown[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_KEY not set");
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
    ACTOR_ID,
  )}/run-sync-get-dataset-items`;
  const body: Record<string, unknown> = {
    searchQueries: [opts.query],
    resultsPerPage: opts.resultsPerPage ?? 30,
    shouldDownloadCovers: false,
    shouldDownloadVideos: false,
    shouldDownloadSlideshowImages: true,
  };
  if (opts.sortByLikes) {
    body.searchSection = "/video";
    body.videoSearchSorting = "MOST_LIKED";
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${APIFY_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `Apify search-query run failed (${opts.query}): ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

// --- cheaper third-party actors (Deep Research) --------------------------------
//
// The clockworks actor charges $0.003/result whether or not a result clears
// our view floor. For Deep Research (many searches + many baseline scrapes,
// most results discarded) these two actors cut the per-run cost ~3-6x with a
// server-side view filter and a near-free baseline lookup. Both are wrapped
// so Deep Research can fall back to clockworks on any failure.

const SEARCH_ACTOR_CHEAP =
  process.env.APIFY_TIKTOK_SEARCH_ACTOR_ID ?? "paul_44~tiktok-search";
const USER_ACTOR_CHEAP =
  process.env.APIFY_TIKTOK_USER_ACTOR_ID ?? "novi~tiktok-user-api";

/**
 * paul_44/tiktok-search — $0.0009/result with a SERVER-SIDE `minPlayCount`
 * filter, so a fixed result budget returns only above-floor videos. Returns
 * this actor's own item shape (normalized in growth-research.ts).
 */
export async function runSearchQueryScrapeCheap(opts: {
  query: string;
  maxItems?: number;
  minPlayCount?: number;
}): Promise<unknown[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_KEY not set");
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
    SEARCH_ACTOR_CHEAP,
  )}/run-sync-get-dataset-items`;
  const body = {
    keywords: [opts.query],
    maxItems: opts.maxItems ?? 25,
    minPlayCount: opts.minPlayCount ?? 0,
    sortType: "MOST_LIKED",
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${APIFY_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `Apify cheap-search run failed (${opts.query}): ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

/**
 * novi/tiktok-user-api — ~$0.0001 for a creator's recent posts (vs $0.03 on
 * clockworks) purely to compute a baseline median. Returns this actor's own
 * item shape (view counts under statistics.play_count).
 */
export async function runProfileScrapeCheap(opts: {
  profile: string;
  limit?: number;
}): Promise<unknown[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_KEY not set");
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
    USER_ACTOR_CHEAP,
  )}/run-sync-get-dataset-items`;
  const body = {
    usernames: [opts.profile],
    limit: opts.limit ?? 10,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${APIFY_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `Apify cheap-profile run failed (${opts.profile}): ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

/**
 * Single-post scrape WITH video download. The actor mirrors the video
 * file into Apify's key-value store and returns a `mediaUrls` link that
 * stays fetchable (raw TikTok CDN URLs 403 without cookies). Used by the
 * Deep Research inspect phase to hand video bytes to Gemini.
 */
export async function runPostScrape(opts: {
  postUrl: string;
}): Promise<unknown[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_KEY not set");
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
    ACTOR_ID,
  )}/run-sync-get-dataset-items`;
  const body = {
    postURLs: [opts.postUrl],
    resultsPerPage: 1,
    shouldDownloadCovers: false,
    shouldDownloadVideos: true,
    shouldDownloadSlideshowImages: false,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${APIFY_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `Apify post run failed (${opts.postUrl}): ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

/**
 * Profile-mode scrape — fetches a single TikTok creator's recent posts
 * so we can compute their baseline view count and the outlier score of
 * any individual post against that baseline.
 *
 * Light-weight: skips slideshow image download since we only need view
 * counts. ~$0.05 per call at 10 results.
 */
export async function runProfileScrape(opts: {
  profile: string;
  resultsPerPage?: number;
}): Promise<unknown[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_KEY not set");
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
    ACTOR_ID,
  )}/run-sync-get-dataset-items`;
  const body = {
    profiles: [opts.profile],
    resultsPerPage: opts.resultsPerPage ?? 10,
    shouldDownloadCovers: false,
    shouldDownloadVideos: false,
    shouldDownloadSlideshowImages: false,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${APIFY_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `Apify profile run failed (${opts.profile}): ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? data : [];
}
