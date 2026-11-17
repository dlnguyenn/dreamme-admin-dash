/**
 * Daily search-rank check (src/lib/aso/ranks.ts). Vercel cron at 13:00 UTC,
 * plus /api/cron/aso-ranks-2 at 15:00: each call checks the terms not yet done today until its time
 * budget runs out (Apple throttles the search API), so two calls cover ~150.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { runRankChecks } from "@/lib/aso/ranks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const result = await runRankChecks();
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
