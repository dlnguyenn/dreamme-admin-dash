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
import { fetchChart, revenueCatConfigured } from "@/lib/vendors/revenuecat";
import {
  transformTrialChart,
  type PricingExperimentResponse,
} from "@/lib/pricing-experiment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 84; // 12 weeks — covers pre-change baselines + the reads

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
    const end = new Date();
    const start = new Date(end.getTime() - WINDOW_DAYS * 86_400_000);
    const chart = await fetchChart({
      chartName: "trial_conversion_rate",
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      resolution: "week",
      segment: "product_duration",
    });
    const body: PricingExperimentResponse = {
      fetchedAt: new Date().toISOString(),
      weeks: transformTrialChart(chart),
    };
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
