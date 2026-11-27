/**
 * Daily App Store Connect analytics pull (src/lib/aso/asc-analytics.ts) into
 * aso_store_daily. Vercel cron, 12:15 UTC. Apple keeps only ~35 days of daily
 * instances, so a missed week still recovers, a missed month doesn't.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { ascAnalyticsConfigured, syncAsoStore } from "@/lib/aso/asc-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!ascAnalyticsConfigured()) return NextResponse.json({ ok: false, error: "ASC_* env vars not set" }, { status: 500 });
  try {
    const result = await syncAsoStore();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
