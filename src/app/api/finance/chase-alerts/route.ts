/**
 * Chase alerts on the Spend tab (src/lib/finance/chase-alerts-store.ts).
 *
 * GET  — freshness, monthly spend by category (last 6 months), recent
 *        business rows, and any Chase email the parser couldn't read.
 * POST — sync now (the daily cron does the same).
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { chaseAlertsDbConfigured, loadChaseSummary, syncChaseAlerts } from "@/lib/finance/chase-alerts-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function guard(req: Request): NextResponse | null {
  if (!checkIngestAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!chaseAlertsDbConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  }
  return null;
}

const fail = (e: unknown) =>
  NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });

export async function GET(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  try {
    return NextResponse.json({ ok: true, summary: await loadChaseSummary() });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  try {
    const result = await syncChaseAlerts({ trigger: "manual" });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (e) {
    return fail(e);
  }
}
