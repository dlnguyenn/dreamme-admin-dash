/**
 * GET /api/overview/attribution — 30 days of source-attribution history.
 *
 * Deliberately NOT part of /api/overview: that payload is polled on an
 * interval and on tab focus (Overview.tsx), and this window is ~11,000 raw
 * signup rows. Re-fetching those every refresh tick to render a panel that
 * defaults to today would be a real cost for no benefit. The panel calls this
 * once, after first paint.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { fetchAttributionSeries } from "@/lib/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await fetchAttributionSeries()) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
