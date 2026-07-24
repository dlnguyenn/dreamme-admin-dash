/**
 * POST /api/support/threads/[id]/retriage — re-run user resolution + AI
 * triage for one thread, producing a fresh draft generation.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  getThread,
  getThreadDrafts,
  supportDbConfigured,
} from "@/lib/support/db";
import { triageOneThread } from "@/lib/support/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!supportDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }
  const { id } = await params;
  try {
    const thread = await getThread(id);
    if (!thread) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    await triageOneThread(thread);
    const [fresh, drafts] = await Promise.all([getThread(id), getThreadDrafts(id)]);
    return NextResponse.json({ ok: true, thread: fresh, drafts });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
