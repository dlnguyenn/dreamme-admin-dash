import type { PersonaId } from "./personas";
import type { ApifyTikTokItem } from "./schemas/apify";

const APIFY_TOKEN = process.env.APIFY_KEY ?? "";
const ACTOR_ID = process.env.APIFY_TIKTOK_ACTOR_ID ?? "clockworks~tiktok-scraper";
const COMMENTS_ACTOR_ID =
  process.env.APIFY_TIKTOK_COMMENTS_ACTOR_ID ??
  "clockworks~tiktok-comments-scraper";

export const PERSONA_TIKTOK_PROFILES: Record<PersonaId, string> = {
  andrea: "andreaglp1",
  emma: "glp1withemma",
  olivia: "glpolivia",
  mia: "glp1withmia",
  abby: "abby_millerrrr",
  diane: "",
  sydney: "glp1withsydney",
  maddy: "maddyglp1",
  hannah: "glp1withmshannahlane",
  // Casting-test candidates + jess: no TikTok handle (not in TikTok rotation).
  hailey: "",
  taylor: "",
  max: "",
  ava: "",
  rachel: "",
  sarah: "",
  jessica: "",
  alex: "",
  maya: "",
  jess: "",
};

export function apifyConfigured() {
  return !!APIFY_TOKEN;
}

export async function runTikTokScrape(opts: {
  profiles: string[];
  resultsPerPage?: number;
  /** "latest" (default) | "popular" | "oldest". "popular" surfaces a
   *  creator's most-viewed posts (used to find their top slideshows). */
  profileSorting?: "latest" | "popular" | "oldest";
}): Promise<unknown[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_KEY not set");
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
    ACTOR_ID,
  )}/run-sync-get-dataset-items`;
  const body: Record<string, unknown> = {
    profiles: opts.profiles,
    resultsPerPage: opts.resultsPerPage ?? 30,
    ...(opts.profileSorting ? { profileSorting: opts.profileSorting } : {}),
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
    throw new Error(`Apify run failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

/**
 * Scrape a single TikTok post (or small list) by URL. Used by the
 * Resources "References" subtab — the actor supports `postURLs` input
 * for per-post scrapes when the caller knows the exact URL.
 */
export async function runTikTokPostScrape(opts: {
  postUrls: string[];
}): Promise<unknown[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_KEY not set");
  if (!opts.postUrls.length) return [];
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
    ACTOR_ID,
  )}/run-sync-get-dataset-items`;
  const body = {
    postURLs: opts.postUrls,
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
    throw new Error(`Apify post scrape failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

/**
 * Scrape the top comments on a single TikTok post via the dedicated
 * clockworks comments actor (returns comment items directly in the
 * dataset, unlike the main scraper which offloads them to a side dataset).
 * `topLevelComments` caps top-level (non-reply) comments; replies are off.
 */
export async function runTikTokCommentsScrape(opts: {
  postUrl: string;
  topLevelComments?: number;
}): Promise<unknown[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_KEY not set");
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
    COMMENTS_ACTOR_ID,
  )}/run-sync-get-dataset-items`;
  const body = {
    postURLs: [opts.postUrl],
    topLevelCommentsPerPost: opts.topLevelComments ?? 20,
    maxRepliesPerComment: 0,
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
      `Apify comments scrape failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

export function extractFirstSlideUrl(p: ApifyTikTokItem): string | null {
  const first = p.slideshowImageLinks?.[0];
  if (first) {
    return first.downloadLink ?? first.tiktokLink ?? null;
  }
  return p.videoMeta?.originalCoverUrl ?? p.videoMeta?.coverUrl ?? null;
}
