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
import { fetchMmp } from "@/lib/mmp/data";
import { fetchMetaLive } from "@/lib/mmp/meta-live";

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
    const [data, meta] = await Promise.all([
      fetchMmp(),
      fetchMetaLive().catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))),
    ]);
    return NextResponse.json({
      ok: true,
      ...data,
      meta: meta instanceof Error ? null : meta,
      metaError: meta instanceof Error ? meta.message : null,
    });
  } catch (e) {
    const msg = e instanceof MissingTableError ? `${e.message}: a migration (0098-0101) is not applied` : e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
