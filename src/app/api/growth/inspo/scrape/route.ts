/**
 * On-demand Viral App Inspo scrape — used by the dashboard UI (phase 3)
 * and for testing. Accepts a handle subset so a single new watchlist
 * entry can be scraped immediately without a full run.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { scrapeViralApps } from "@/lib/viral-apps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  handles: z.array(z.string().min(1)).max(50).optional(),
  include_discovery: z.boolean().optional(),
  results_per_profile: z.number().int().min(1).max(30).optional(),
});

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json().catch(() => ({})));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid body" },
      { status: 400 },
    );
  }
  try {
    const summary = await scrapeViralApps({
      handles: body.handles,
      includeDiscovery: body.include_discovery,
      resultsPerProfile: body.results_per_profile,
    });
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
