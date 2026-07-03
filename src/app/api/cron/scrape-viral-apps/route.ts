/**
 * Viral App Inspo scrape — Tue/Fri, one invocation per platform
 * (?platform=tiktok at 04:30 UTC, ?platform=instagram at 05:15) so a
 * cold run of either leg stays comfortably inside the 300s budget.
 * Omitting ?platform scrapes both (fine for manual triggers).
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { scrapeViralApps, type Platform } from "@/lib/viral-apps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const platformParam = new URL(req.url).searchParams.get("platform");
  const platforms: Platform[] | undefined =
    platformParam === "tiktok" || platformParam === "instagram" ? [platformParam] : undefined;
  try {
    // includeDiscovery omitted → respects the saved "discovery sweep" toggle.
    const summary = await scrapeViralApps({ platforms });
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
