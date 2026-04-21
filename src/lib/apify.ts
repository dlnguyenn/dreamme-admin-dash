import type { PersonaId } from "./personas";
import type { ApifyTikTokItem } from "./schemas/apify";

const APIFY_TOKEN = process.env.APIFY_KEY ?? "";
const ACTOR_ID = process.env.APIFY_TIKTOK_ACTOR_ID ?? "clockworks~tiktok-scraper";

export const PERSONA_TIKTOK_PROFILES: Record<PersonaId, string> = {
  andrea: "andreaglp1",
  emma: "glp1withemma",
  olivia: "glpolivia",
};

export function apifyConfigured() {
  return !!APIFY_TOKEN;
}

export async function runTikTokScrape(opts: {
  profiles: string[];
  resultsPerPage?: number;
}): Promise<unknown[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_KEY not set");
  const url = `https://api.apify.com/v2/acts/${encodeURIComponent(
    ACTOR_ID,
  )}/run-sync-get-dataset-items`;
  const body = {
    profiles: opts.profiles,
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
    throw new Error(`Apify run failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

export function extractFirstSlideUrl(p: ApifyTikTokItem): string | null {
  if (Array.isArray(p.slideshowImageLinks) && p.slideshowImageLinks.length) {
    return p.slideshowImageLinks[0];
  }
  return p.videoMeta?.originalCoverUrl ?? p.videoMeta?.coverUrl ?? null;
}
