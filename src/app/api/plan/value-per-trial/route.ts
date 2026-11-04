/**
 * GET /api/plan/value-per-trial?weeks=16 — weekly trial-start cohorts by
 * source group with payer rate, yearly share, 7/30-day gross revenue and
 * projected 12-month net per trial (src/lib/revenue-plan/value-per-trial.ts).
 * Feeds the April Plan tab's Value per trial view.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { consumerConfigured, internalConfigured } from "@/lib/revenue-plan/db";
import { DEFAULT_WEEKS, loadValuePerTrial } from "@/lib/revenue-plan/value-per-trial-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!internalConfigured() || !consumerConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase env missing (internal service role or CONSUMER_*)" }, { status: 500 });
  }
  const weeks = Math.min(26, Math.max(8, Number(new URL(req.url).searchParams.get("weeks")) || DEFAULT_WEEKS));
  try {
    return NextResponse.json({ ok: true, ...(await loadValuePerTrial(weeks)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
