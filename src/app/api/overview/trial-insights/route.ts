/**
 * GET /api/overview/trial-insights — the Overview trial tiles opened up
 * (src/lib/trial-insights.ts): why yesterday's trial starts moved, and
 * today's pace with an end-of-day estimate. Precomputed like the rest of
 * Overview (src/lib/dad-cache.ts); ?fresh=1 recomputes.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { internalConfigured } from "@/lib/revenue-plan/db";
import { cached, wantsFresh } from "@/lib/dad-cache";
import { cacheJobs } from "@/lib/dad-cache-jobs";

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
    const job = cacheJobs()["trial-insights"];
    const { value, meta } = await cached("trial-insights", job.policy, job.run, { force: wantsFresh(req) });
    return NextResponse.json({ ok: true, ...(value as object), cache: meta });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
