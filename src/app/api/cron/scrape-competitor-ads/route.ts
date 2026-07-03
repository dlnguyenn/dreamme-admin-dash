/**
 * Competitor-ads monitor — Tue/Fri 05:45 UTC (after the viral-apps IG leg
 * at 05:15). Scrapes every active tracked brand; new ads get analyzed and
 * badge counts update. Skips cleanly when SCRAPECREATORS_API_KEY is unset.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { scrapeAllBrands, scConfigured, NO_SC_KEY } from "@/lib/competitor-ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!scConfigured()) {
    return NextResponse.json({ ok: false, skipped: true, note: NO_SC_KEY });
  }
  try {
    const summary = await scrapeAllBrands();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
