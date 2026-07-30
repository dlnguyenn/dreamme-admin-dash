/**
 * Daily clipper video sync (vercel.json: 0 9 * * *).
 *
 * Two legs per run:
 *   1. PAGE SYNC — for each active clipper with a facebook_page_url, scrape
 *      their page (ScrapeCreators reels feed by default). That feed carries
 *      view counts, so this single pass does BOTH discovery of new posts and
 *      the daily view refresh, at ~$0.0002/video.
 *   2. ORPHAN REFRESH — per-URL lookups for the leftovers only: videos a
 *      clipper pasted by hand, or ones whose page isn't connected. This is the
 *      expensive path (1 credit each), so leg 1 deliberately shrinks it.
 *
 * Query params: ?discover=0 skips leg 1, ?refresh=0 skips leg 2 (debugging).
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { fbViewsConfigured, fbProvider, fetchViewsForUrls } from "@/lib/facebookViews";
import {
  syncClipperPage,
  writeViewHistory,
  acceptViewUpdate,
  todayISODate,
} from "@/lib/clipperSync";
import {
  clippersDbConfigured,
  sbGet,
  sbPost,
  type ClipperRow,
  type ClipperVideoRow,
} from "@/lib/clippers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Reels pages per clipper per run: 10 videos each, 1 credit each. */
const PAGES_PER_CLIPPER = 10;
/** Hard ceiling on the expensive per-URL leg. */
const MAX_ORPHAN_REFRESH = 400;
const CHUNK = 100;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!clippersDbConfigured()) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 503 });
  }
  if (!fbViewsConfigured()) {
    return NextResponse.json({ error: "no facebook scraping provider configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const doDiscover = url.searchParams.get("discover") !== "0";
  const doRefresh = url.searchParams.get("refresh") !== "0";

  const clippers = await sbGet<ClipperRow[]>(
    "clippers?active=eq.true&select=id,name,code,facebook_page_url&limit=200",
  );

  // --- 1) page sync (discovery + views in one pass) --------------------------
  let discovered = 0;
  let pageViews = 0;
  const coveredUrls = new Set<string>();
  const discoveryErrors: string[] = [];

  if (doDiscover) {
    for (const c of clippers) {
      if (!c.facebook_page_url) continue;
      try {
        const res = await syncClipperPage(
          c.id,
          c.facebook_page_url,
          c.code,
          PAGES_PER_CLIPPER,
        );
        discovered += res.discovered;
        pageViews += res.withViews;
        for (const u of res.urls) coveredUrls.add(u);
        discoveryErrors.push(...res.errors);
      } catch (e) {
        discoveryErrors.push(`${c.code}: ${(e as Error).message.slice(0, 150)}`);
      }
    }
  }

  // --- 2) orphan refresh (per-URL, only what leg 1 missed) -------------------
  let updated = 0;
  let failed = 0;
  let skipped = 0;
  const refreshErrors: string[] = [];

  if (doRefresh) {
    const all = await sbGet<ClipperVideoRow[]>(
      "clipper_videos?active=eq.true&platform=eq.facebook&select=id,url,views,clipper_id&limit=1000",
    );
    const candidates = all.filter((v) => !coveredUrls.has(v.url));
    const orphans = candidates.slice(0, MAX_ORPHAN_REFRESH);
    // Never let a cap silently look like full coverage.
    skipped = candidates.length - orphans.length;
    if (skipped > 0) {
      refreshErrors.push(`orphan refresh capped: ${skipped} video(s) not refreshed this run`);
    }

    if (orphans.length > 0) {
      try {
        const counts = await fetchViewsForUrls(orphans.map((v) => v.url));
        const byUrl = new Map(counts.map((c) => [c.url, c]));
        const now = new Date().toISOString();
        const date = todayISODate();
        const patches: Record<string, unknown>[] = [];
        const history: { video_id: string; date: string; views: number }[] = [];

        for (const v of orphans) {
          const hit = byUrl.get(v.url);
          if (hit?.views != null && acceptViewUpdate(v.views, hit.views)) {
            patches.push({
              id: v.id,
              clipper_id: v.clipper_id,
              url: v.url,
              views: hit.views,
              views_updated_at: now,
              scrape_status: "ok",
            });
            history.push({ video_id: v.id, date, views: hit.views });
            updated++;
          } else {
            // Always leave a reason on the row — a stale count with no status
            // is indistinguishable from a video nobody watched.
            patches.push({
              id: v.id,
              clipper_id: v.clipper_id,
              url: v.url,
              scrape_status: hit?.status ?? "not_returned",
            });
            failed++;
          }
        }

        // Batched upserts instead of one PATCH per video (was up to 1000
        // sequential round trips inside a 300s budget).
        for (let i = 0; i < patches.length; i += CHUNK) {
          try {
            await sbPost("clipper_videos", patches.slice(i, i + CHUNK), { onConflict: "url" });
          } catch (e) {
            refreshErrors.push(`patch: ${(e as Error).message.slice(0, 150)}`);
          }
        }
        await writeViewHistory(history, refreshErrors);
      } catch (e) {
        refreshErrors.push((e as Error).message.slice(0, 200));
      }
    }
  }

  return NextResponse.json({
    ok: true,
    provider: fbProvider(),
    clippers: clippers.length,
    discovered,
    pageViews,
    updated,
    failed,
    skipped,
    ...(discoveryErrors.length ? { discoveryErrors: discoveryErrors.slice(0, 20) } : {}),
    ...(refreshErrors.length ? { refreshErrors: refreshErrors.slice(0, 20) } : {}),
  });
}
