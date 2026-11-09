/**
 * GET /api/mmp — live numbers for the MMP tab: the 35-day snapshot from every
 * attribution pipe, every method side by side per campaign and per ad,
 * trial-to-paid by age, the weekly ad set checks, App Store downloads by
 * source (src/lib/mmp, migrations 0098-0101), and Meta's live age mix and ad
 * set settings. A Meta failure is returned as metaError, not a 500.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { MissingTableError, internalConfigured } from "@/lib/revenue-plan/db";
import { POLICY, cached, wantsFresh } from "@/lib/dad-cache";
import { loadMmpPayload } from "@/lib/dad-cache-jobs";

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
    // Precomputed (src/lib/dad-cache.ts). The snapshot itself now reads the
    // materialized view mmp_snapshot_mv (migration 0106), refreshed by pg_cron:
    // the plain view outgrew PostgREST's 8 s statement timeout.
    const { value, meta } = await cached("mmp", POLICY.daily, loadMmpPayload, { force: wantsFresh(req) });
    return NextResponse.json({ ok: true, ...value, cache: meta });
  } catch (e) {
    const msg = e instanceof MissingTableError ? `${e.message}: a migration (0098-0101) is not applied` : e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
