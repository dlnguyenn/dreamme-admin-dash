/**
 * POST /api/support/poll — manual "Poll now" from the Support Inbox UI.
 * Same orchestration as the cron; same-origin auth via checkIngestAuth.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { runIngest } from "@/lib/support/ingest";
import { supportDbConfigured } from "@/lib/support/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!supportDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }
  const report = await runIngest();
  return NextResponse.json({ ok: true, report });
}
