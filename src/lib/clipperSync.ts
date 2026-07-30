/**
 * Shared "scan a clipper's Facebook page and persist what we found" routine.
 *
 * Used by both the daily cron (/api/cron/sync-clipper-views) and the instant
 * scan that runs the moment a clipper connects their page
 * (/api/clippers/connect-page), so the two can never drift apart.
 *
 * Under the ScrapeCreators provider the page scan returns view counts inline,
 * so one pass does discovery *and* the daily refresh.
 */
import { discoverPageVideos, normalizeFacebookUrl } from "./facebookViews";
import { sbGet, sbPost, type ClipperVideoRow } from "./clippers";

/** PostgREST payloads stay well under URL/body limits at this size. */
const CHUNK = 100;

export interface PageSyncResult {
  /** rows sent to the DB (new + updated) */
  discovered: number;
  /** rows that carried a fresh view count */
  withViews: number;
  /** normalized URLs touched — the cron uses this to skip them in leg 2 */
  urls: string[];
  errors: string[];
}

export function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Views should never fall. The reels feed reports Facebook's rounded public
 * badge (104,000) while the per-post endpoint reports the exact count
 * (105,117), so the two sources disagree by up to a rounding step — without
 * this guard a video's count visibly bounces day to day, and a partial scrape
 * could wipe a real number. Allow a 5% slack for genuine corrections.
 */
export function acceptViewUpdate(prev: number | null | undefined, next: number): boolean {
  if (next < 0) return false;
  if (prev == null) return true;
  return next >= Number(prev) * 0.95;
}

async function chunkedUpsert(
  rows: Record<string, unknown>[],
  errors: string[],
  label: string,
): Promise<number> {
  let ok = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    try {
      await sbPost("clipper_videos", slice, { onConflict: "url" });
      ok += slice.length;
    } catch (e) {
      // One bad row must not take down the whole batch.
      errors.push(`${label}: ${(e as Error).message.slice(0, 150)}`);
    }
  }
  return ok;
}

export async function writeViewHistory(
  rows: { video_id: string; date: string; views: number }[],
  errors: string[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    try {
      await sbPost("clipper_video_views", rows.slice(i, i + CHUNK), {
        onConflict: "video_id,date",
      });
    } catch (e) {
      errors.push(`history: ${(e as Error).message.slice(0, 150)}`);
    }
  }
}

/**
 * Scrape one clipper's page and upsert their videos (with views when the
 * provider supplies them). Safe to call repeatedly — everything is an upsert
 * keyed on the normalized URL.
 */
export async function syncClipperPage(
  clipperId: string,
  pageUrl: string,
  label: string,
  maxPages = 10,
): Promise<PageSyncResult> {
  const errors: string[] = [];
  const videos = await discoverPageVideos(pageUrl, maxPages);
  if (videos.length === 0) {
    return { discovered: 0, withViews: 0, urls: [], errors };
  }

  // Existing rows let us apply the never-decrease guard and map url → id for
  // the view-history write.
  const existing = await sbGet<ClipperVideoRow[]>(
    `clipper_videos?clipper_id=eq.${clipperId}&select=id,url,views&limit=1000`,
  );
  const byUrl = new Map(existing.map((v) => [v.url, v]));

  const now = new Date().toISOString();
  let withViews = 0;
  const rows = videos.map((v) => {
    const url = normalizeFacebookUrl(v.url);
    const prev = byUrl.get(url);
    const takeViews = v.views != null && acceptViewUpdate(prev?.views, v.views);
    if (takeViews) withViews++;
    return {
      clipper_id: clipperId,
      url,
      external_id: v.externalId,
      platform: "facebook",
      title: v.title,
      posted_at: v.postedAt,
      source: "scraped",
      ...(takeViews ? { views: v.views, views_updated_at: now, scrape_status: "ok" } : {}),
    };
  });

  const discovered = await chunkedUpsert(rows, errors, label);

  // History needs video ids, which new rows only have after the upsert.
  const urls = rows.map((r) => r.url);
  if (withViews > 0) {
    const after = await sbGet<ClipperVideoRow[]>(
      `clipper_videos?clipper_id=eq.${clipperId}&select=id,url&limit=1000`,
    );
    const idByUrl = new Map(after.map((v) => [v.url, v.id]));
    const date = todayISODate();
    const history = rows
      .filter((r) => typeof r.views === "number" && idByUrl.has(r.url))
      .map((r) => ({
        video_id: idByUrl.get(r.url) as string,
        date,
        views: r.views as number,
      }));
    await writeViewHistory(history, errors);
  }

  return { discovered, withViews, urls, errors };
}
