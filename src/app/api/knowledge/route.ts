/**
 * GET /api/knowledge: the Knowledge tab's index (library, wiki pages, recent log, expert feeds),
 * read live from the vault repo. Needs the x-knowledge-key passphrase; see src/lib/knowledge.ts.
 * ?refresh=1 skips the 5-minute cache.
 */
import { NextResponse } from "next/server";
import { getKnowledgeIndex, knowledgeAuthError } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = knowledgeAuthError(req);
  if (denied) return NextResponse.json({ ok: false, error: denied.error }, { status: denied.status });
  try {
    const refresh = new URL(req.url).searchParams.get("refresh") === "1";
    return NextResponse.json({ ok: true, ...(await getKnowledgeIndex(refresh)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
