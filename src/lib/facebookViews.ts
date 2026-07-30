/**
 * Provider dispatcher for clipper Facebook view tracking.
 *
 * ScrapeCreators is primary (~$0.0002/video via the reels feed, which returns
 * discovery *and* views in one call); the original Apify actors stay as a
 * fallback (~$0.004/video, two separate runs). Same switch pattern as the
 * Viral Slideshows provider migration.
 *
 *   CLIPPER_FB_PROVIDER = "scrapecreators" | "apify"
 *
 * Unset → ScrapeCreators when SCRAPECREATORS_API_KEY exists, else Apify. That
 * way prod keeps working on Apify until the key is added to Vercel, and flips
 * over automatically once it is.
 */
import {
  apifyFacebookConfigured,
  discoverPageVideos as apifyDiscoverPageVideos,
  fetchPlayCounts as apifyFetchPlayCounts,
  type FacebookPageVideo,
} from "./apify-facebook";
import {
  scFacebookConfigured,
  fetchPageReels,
  fetchPostMetricsBatch,
  normalizeFacebookUrl,
  type FacebookPostMetrics,
} from "./scrapecreators-facebook";

export type FbProvider = "scrapecreators" | "apify";
export type { FacebookPageVideo, FacebookPostMetrics };
export { normalizeFacebookUrl };

export function fbProvider(): FbProvider {
  const forced = (process.env.CLIPPER_FB_PROVIDER ?? "").trim().toLowerCase();
  if (forced === "apify") return "apify";
  if (forced === "scrapecreators") return "scrapecreators";
  return scFacebookConfigured() ? "scrapecreators" : "apify";
}

export function fbViewsConfigured(): boolean {
  return fbProvider() === "scrapecreators" ? scFacebookConfigured() : apifyFacebookConfigured();
}

/**
 * A page's recent videos. Under ScrapeCreators these carry live view counts,
 * so callers can treat discovery as a refresh too; under Apify `views` is
 * usually null and the caller must fall back to fetchViewsForUrls.
 */
export async function discoverPageVideos(
  pageUrl: string,
  maxPages = 10,
): Promise<FacebookPageVideo[]> {
  if (fbProvider() === "scrapecreators") {
    return fetchPageReels(pageUrl, maxPages);
  }
  // Apify's posts scraper takes a result count, not a page count.
  const videos = await apifyDiscoverPageVideos(pageUrl, maxPages * 10);
  return videos.map((v) => ({ ...v, url: normalizeFacebookUrl(v.url) }));
}

// --- page-URL validation (used by the clipper-facing connect route) ---------

const PAGE_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com"]);
/** Path segments that mean "this is a single post", not a page. */
const POST_MARKERS = ["/posts/", "/reel/", "/reels/", "/videos/", "/video/", "/watch", "/photo", "/story.php", "/permalink.php", "/share/", "/groups/", "/events/", "/marketplace"];
/** Tabs a creator is likely to copy out of their own address bar. */
const TRAILING_TABS = ["reels", "videos", "photos", "about", "posts", "live", "shop", "reviews"];

export interface PageUrlResult {
  ok: boolean;
  url?: string;
  error?: string;
}

/**
 * Validate + canonicalize a clipper-supplied Facebook *page* URL.
 *
 * Rejects single-post links (the most likely mistake — people copy the link to
 * one reel) and non-Facebook hosts. Strips a trailing tab like /reels so
 * "facebook.com/mypage/reels" and "facebook.com/mypage" are one page.
 */
export function normalizeFacebookPageUrl(raw: string): PageUrlResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "Paste your Facebook page link" };

  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(withProto);
  } catch {
    return { ok: false, error: "That doesn't look like a link" };
  }
  const host = u.hostname.toLowerCase().replace(/^(web|mbasic|business|free)\./, "www.");
  if (!PAGE_HOSTS.has(host)) {
    return { ok: false, error: "Needs to be a facebook.com page link" };
  }

  // profile.php?id=123 is a legitimate page form; keep its id.
  const isProfilePhp = u.pathname.toLowerCase() === "/profile.php";
  const profileId = u.searchParams.get("id");
  if (isProfilePhp && !profileId) {
    return { ok: false, error: "That profile link is missing its id" };
  }

  const segments = u.pathname.split("/").filter(Boolean);
  if (!isProfilePhp) {
    if (segments.length === 0) {
      return { ok: false, error: "Add your page name, e.g. facebook.com/yourpage" };
    }
    // Drop a trailing tab FIRST, so "/mypage/videos" (the page's video tab)
    // becomes "/mypage" and isn't mistaken for "/mypage/videos/12345" (one
    // video, which must still be rejected below).
    if (segments.length > 1 && TRAILING_TABS.includes(segments[segments.length - 1].toLowerCase())) {
      segments.pop();
    }
  }

  const checkPath = isProfilePhp ? "/profile.php" : `/${segments.join("/")}/`;
  if (POST_MARKERS.some((m) => checkPath.toLowerCase().includes(m))) {
    return {
      ok: false,
      error: "That's a link to one post — paste your page link instead (facebook.com/yourpage)",
    };
  }
  if (!isProfilePhp && segments.length > 2) {
    return { ok: false, error: "Paste the main page link, e.g. facebook.com/yourpage" };
  }

  const path = isProfilePhp ? "/profile.php" : `/${segments.join("/")}`;
  const query = isProfilePhp ? `?id=${encodeURIComponent(profileId as string)}` : "";
  return { ok: true, url: `https://www.facebook.com${path}${query}` };
}

/** Per-URL view counts — the expensive path, for videos not on a tracked page. */
export async function fetchViewsForUrls(urls: string[]): Promise<FacebookPostMetrics[]> {
  if (urls.length === 0) return [];
  if (fbProvider() === "scrapecreators") {
    return fetchPostMetricsBatch(urls);
  }
  const counts = await apifyFetchPlayCounts(urls);
  return counts.map((c) => ({
    url: normalizeFacebookUrl(c.url),
    views: c.playCount,
    status: c.status,
  }));
}
