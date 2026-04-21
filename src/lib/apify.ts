import type { PersonaId } from "./personas";

const APIFY_TOKEN = process.env.APIFY_KEY ?? "";
const ACTOR_ID = process.env.APIFY_TIKTOK_ACTOR_ID ?? "clockworks~tiktok-scraper";

export const PERSONA_TIKTOK_PROFILES: Record<PersonaId, string> = {
  andrea: "andreaglp1",
  emma: "glp1withemma",
  olivia: "glpolivia",
};

export interface ApifyTikTokPost {
  id?: string;
  webVideoUrl?: string;
  text?: string;
  createTimeISO?: string;
  playCount?: number;
  diggCount?: number;
  commentCount?: number;
  shareCount?: number;
  authorMeta?: { name?: string };
  videoMeta?: { coverUrl?: string; originalCoverUrl?: string };
  images?: Array<string | { imageUrl?: string; url?: string }>;
  slideshowImageLinks?: string[];
  isSlideshow?: boolean;
  [k: string]: unknown;
}

export function apifyConfigured() {
  return !!APIFY_TOKEN;
}

function runActorUrl(sync = true) {
  const base = `https://api.apify.com/v2/acts/${encodeURIComponent(ACTOR_ID)}/${
    sync ? "run-sync-get-dataset-items" : "runs"
  }`;
  return `${base}?token=${APIFY_TOKEN}`;
}

export async function runTikTokScrape(opts: {
  profiles: string[];
  resultsPerPage?: number;
}): Promise<ApifyTikTokPost[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_KEY not set");
  const body = {
    profiles: opts.profiles,
    resultsPerPage: opts.resultsPerPage ?? 30,
    shouldDownloadCovers: false,
    shouldDownloadVideos: false,
    shouldDownloadSlideshowImages: false,
    proxyCountryCode: "None",
  };
  const res = await fetch(runActorUrl(true), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Apify run failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as ApifyTikTokPost[];
}

export function extractFirstSlideUrl(p: ApifyTikTokPost): string | null {
  if (Array.isArray(p.slideshowImageLinks) && p.slideshowImageLinks.length) {
    return p.slideshowImageLinks[0];
  }
  if (Array.isArray(p.images) && p.images.length) {
    const first = p.images[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      return first.imageUrl ?? first.url ?? null;
    }
  }
  return p.videoMeta?.originalCoverUrl ?? p.videoMeta?.coverUrl ?? null;
}
