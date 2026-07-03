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
 */
export async function runSearchQueryScrape(opts: {
  query: string;
  resultsPerPage?: number;
}): Promise<unknown[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_KEY not set");
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
    ACTOR_ID,
  )}/run-sync-get-dataset-items`;
  const body = {
    searchQueries: [opts.query],
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
      `Apify search-query run failed (${opts.query}): ${res.status} ${await res.text()}`,
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
