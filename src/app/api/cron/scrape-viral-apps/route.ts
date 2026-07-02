/**
 * Viral App Inspo scrape — Tue/Fri 04:30 UTC (offset from scrape-spy's
 * Mon/Wed/Fri 03:00). Watchlist profile scrapes + discovery hashtags,
 * 50k-view floor, Haiku classification, thumbnail re-hosting.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { scrapeViralApps } from "@/lib/viral-apps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await scrapeViralApps({ includeDiscovery: true });
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
