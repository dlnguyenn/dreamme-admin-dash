/**
 * Support Inbox poll (vercel.json: every 20 min).
 *
 * 1. IMAP-polls the dan@dreamme.life inbox (help@ / feedback@ alias mail)
 * 2. Polls the consumer public.feedback table for new in-app feedback
 * 3. Triages fresh threads (classification + two reply drafts)
 *
 * All legs are idempotent — see src/lib/support/ingest.ts.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { runIngest } from "@/lib/support/ingest";
import { supportDbConfigured } from "@/lib/support/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!supportDbConfigured()) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 503 });
  }
  const report = await runIngest();
  return NextResponse.json({ ok: true, report });
}
