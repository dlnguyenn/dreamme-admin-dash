/**
 * GET /api/mmp — live numbers for the MMP tab: one snapshot row of 35-day
 * counts from every attribution pipe, and each campaign with every method
 * side by side (src/lib/mmp, migration 0098).
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { MissingTableError, internalConfigured } from "@/lib/revenue-plan/db";
import { fetchMmp } from "@/lib/mmp/data";

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
    return NextResponse.json({ ok: true, ...(await fetchMmp()) });
  } catch (e) {
    const msg = e instanceof MissingTableError ? "mmp_snapshot does not exist yet: migration 0098 is not applied" : e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
