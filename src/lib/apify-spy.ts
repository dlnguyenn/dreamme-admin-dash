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
