/**
 * GET /api/knowledge/search?q=: wiki pages, recent log entries and every filed expert post
 * (weekly digests + the LinkedIn year backfill) containing q.
 */
import { NextResponse } from "next/server";
import { knowledgeAuthError, searchKnowledge } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = knowledgeAuthError(req);
  if (denied) return NextResponse.json({ ok: false, error: denied.error }, { status: denied.status });
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 120);
  try {
    return NextResponse.json({ ok: true, hits: await searchKnowledge(q) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
