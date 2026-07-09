/**
 * Daily clipper video sync (vercel.json: 0 9 * * *).
 *
 * Two legs per run:
 *   1. DISCOVERY — for each active clipper with a facebook_page_url, scrape
 *      their page's recent posts (apify~facebook-posts-scraper) and upsert any
 *      video/reel posts into clipper_videos (source='scraped').
 *   2. REFRESH — one batched playcount run over ALL active facebook video
 *      URLs (social_developer~facebook-playcount-scraper), updating
 *      clipper_videos.views and appending today's clipper_video_views row.
 *
 * Query params: ?discover=0 skips leg 1, ?refresh=0 skips leg 2 (debugging).
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import {
  apifyFacebookConfigured,
  discoverPageVideos,
  fetchPlayCounts,
} from "@/lib/apify-facebook";
import {
  clippersDbConfigured,
  sbGet,
  sbPost,
  sbPatch,
  type ClipperRow,
  type ClipperVideoRow,
} from "@/lib/clippers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!clippersDbConfigured()) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 503 });
  }
  if (!apifyFacebookConfigured()) {
    return NextResponse.json({ error: "APIFY_KEY not set" }, { status: 503 });
  }

  const url = new URL(req.url);
  const doDiscover = url.searchParams.get("discover") !== "0";
  const doRefresh = url.searchParams.get("refresh") !== "0";

  const clippers = await sbGet<ClipperRow[]>(
    "clippers?active=eq.true&select=id,name,code,facebook_page_url&limit=200",
  );

  // --- 1) discovery ---------------------------------------------------------
  let discovered = 0;
  const discoveryErrors: string[] = [];
  if (doDiscover) {
    for (const c of clippers) {
      if (!c.facebook_page_url) continue;
      try {
        const videos = await discoverPageVideos(c.facebook_page_url);
        if (videos.length === 0) continue;
        const rows = videos.map((v) => ({
          clipper_id: c.id,
          url: v.url,
          external_id: v.externalId,
          platform: "facebook",
          title: v.title,
          posted_at: v.postedAt,
          source: "scraped",
          // posts-scraper sometimes includes views — seed them, refresh leg
          // will overwrite with playcount data when available
          ...(v.views != null
            ? { views: v.views, views_updated_at: new Date().toISOString() }
            : {}),
        }));
        // url is globally unique — dedupe on it so re-discovered posts merge.
        await sbPost("clipper_videos", rows, { onConflict: "url" });
        discovered += rows.length;
      } catch (e) {
        discoveryErrors.push(`${c.code}: ${(e as Error).message.slice(0, 150)}`);
      }
    }
  }

  // --- 2) refresh play counts ------------------------------------------------
  let updated = 0;
  let failed = 0;
  const refreshErrors: string[] = [];
  if (doRefresh) {
    const videos = await sbGet<ClipperVideoRow[]>(
      "clipper_videos?active=eq.true&platform=eq.facebook&select=id,url&limit=1000",
    );
    if (videos.length > 0) {
      try {
        const counts = await fetchPlayCounts(videos.map((v) => v.url));
        const byUrl = new Map(counts.map((c) => [c.url, c]));
        const today = new Date().toISOString().slice(0, 10);
        const historyRows: { video_id: string; date: string; views: number }[] = [];
        for (const v of videos) {
          const hit = byUrl.get(v.url);
          if (!hit) {
            failed++;
            continue;
          }
          if (hit.playCount != null) {
            await sbPatch(`clipper_videos?id=eq.${v.id}`, {
              views: hit.playCount,
              views_updated_at: new Date().toISOString(),
              scrape_status: "ok",
            });
            historyRows.push({ video_id: v.id, date: today, views: hit.playCount });
            updated++;
          } else {
            await sbPatch(`clipper_videos?id=eq.${v.id}`, { scrape_status: hit.status });
            failed++;
          }
        }
        if (historyRows.length > 0) {
          await sbPost("clipper_video_views", historyRows, { onConflict: "video_id,date" });
        }
      } catch (e) {
        refreshErrors.push((e as Error).message.slice(0, 200));
      }
    }
  }

  return NextResponse.json({
    ok: true,
    clippers: clippers.length,
    discovered,
    updated,
    failed,
    ...(discoveryErrors.length ? { discoveryErrors } : {}),
    ...(refreshErrors.length ? { refreshErrors } : {}),
  });
}
