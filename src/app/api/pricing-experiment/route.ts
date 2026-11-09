/**
 * Weekly trial funnel by plan duration, for the Pricing Experiments panel on
 * the Marketing Efficiency page.
 *
 * GET — last ~12 weeks of RevenueCat trial_conversion_rate, weekly, segmented
 * by product_duration (P1M / P3M / P1Y), transformed to per-week rows. The
 * client computes experiment baselines/reads from these; this route stays a
 * thin RC proxy so the paywall-facing numbers always come straight from RC.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { revenueCatConfigured } from "@/lib/vendors/revenuecat";
import { POLICY, cached, wantsFresh } from "@/lib/dad-cache";
import { loadPricingExperiment } from "@/lib/dad-cache-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!revenueCatConfigured()) {
    return NextResponse.json(
      { error: "REVENUECAT_API_KEY / REVENUECAT_PROJECT_ID not set" },
      { status: 500 },
    );
  }
  try {
    // Precomputed (src/lib/dad-cache.ts); the body is the same shape as before.
    const { value } = await cached("pricing-experiment", POLICY.daily, loadPricingExperiment, {
      force: wantsFresh(req),
    });
    return NextResponse.json(value);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
