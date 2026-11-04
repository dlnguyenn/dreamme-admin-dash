/**
 * GET /api/plan/scorecard — the April Plan scorecard and true P&L
 * (src/lib/revenue-plan/scorecard-data.ts): month-to-date gross vs the plan
 * forecast, model drift, the gap to $100k in April, the Jan 15 checkpoints
 * and monthly contribution.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { consumerConfigured, internalConfigured } from "@/lib/revenue-plan/db";
import { loadScorecard } from "@/lib/revenue-plan/scorecard-data";

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
  try {
    return NextResponse.json({ ok: true, ...(await loadScorecard()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
