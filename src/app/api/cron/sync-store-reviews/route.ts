/**
 * Daily App Store + Google Play review sync into store_reviews
 * (src/lib/store-reviews.ts), plus the daily App Store rating-count snapshot
 * (src/lib/rating-snapshots.ts). Vercel cron, 11:30 UTC. Daily is enough: the
 * Play API keeps 7 days, so a missed run or two loses nothing.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { storeReviewsDbConfigured, syncStoreReviews } from "@/lib/store-reviews";
import { snapshotRatings } from "@/lib/rating-snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!storeReviewsDbConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  }
  try {
    const results = await syncStoreReviews();
    // Rating counts are independent of the review sync: a failure here is
    // reported in the response but doesn't fail the reviews.
    const ratings = await snapshotRatings();
    return NextResponse.json(
      { ok: results.every((r) => r.ok) && ratings.every((r) => r.ok), results, ratings },
      { status: results.some((r) => r.ok) ? 200 : 500 },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
