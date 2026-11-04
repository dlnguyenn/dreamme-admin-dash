/**
 * GET /api/plan/experiments — one row per April-plan A/B test
 * (src/lib/revenue-plan/experiments.ts): arm sizes, trial-to-paid, 30-day
 * revenue per trial net of refunds, the pre-registered stop rule and status.
 * Feeds the April Plan Experiments view and the Pricing Experiments panel.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { internalConfigured } from "@/lib/revenue-plan/db";
import { loadExperiments } from "@/lib/revenue-plan/experiments-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!internalConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  }
  try {
    return NextResponse.json({ ok: true, experiments: await loadExperiments() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
