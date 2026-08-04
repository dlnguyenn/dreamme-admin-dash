/**
 * GET /api/overview — everything the Overview landing tab shows, in one call.
 *
 * Assembled server-side with the service role rather than a dozen client
 * fetches: several of these tables (support_threads, social_posts,
 * slideshow_batches) are service-role only and have no anon read policy.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { buildOverview, overviewDbConfigured } from "@/lib/overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!overviewDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured" },
      { status: 500 },
    );
  }

  try {
    return NextResponse.json({ ok: true, ...(await buildOverview()) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
