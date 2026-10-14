/**
 * GET /api/step-down-test — the Meta iOS spend step-down test (src/lib/step-down.ts):
 * daily RevenueCat trials, Meta spend and onboarding-survey answers for the
 * baseline and test windows, plus the running verdict. Feeds the Step-down
 * Test tab; the daily email cron (/api/cron/step-down-report) reuses it.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { STEP_DOWN, fetchStepDownRows, stepDownDbConfigured, summarize } from "@/lib/step-down";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!stepDownDbConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  }
  try {
    const { rows, today } = await fetchStepDownRows(STEP_DOWN);
    return NextResponse.json({ ok: true, today, rows, summary: summarize(STEP_DOWN, rows, today) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
