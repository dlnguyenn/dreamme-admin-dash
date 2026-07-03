/**
 * On-demand competitor-ads scrape — one brand (page_id) right after the
 * UI adds it, or all active brands. Diff-based: only NEW ads get analyzed.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { scrapeAllBrands, scConfigured, NO_SC_KEY } from "@/lib/competitor-ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({ page_id: z.string().optional() });

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!scConfigured()) {
    return NextResponse.json({ error: NO_SC_KEY }, { status: 500 });
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
    const summary = await scrapeAllBrands(body.page_id);
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
