/**
 * GET /api/knowledge/doc?path=<vault path>: one vault file as plain text (Markdown page,
 * artifact HTML or expert-feed digest). Paths are allowlisted in isAllowedVaultPath.
 */
import { NextResponse } from "next/server";
import { knowledgeAuthError, readVaultDoc } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = knowledgeAuthError(req);
  if (denied) return NextResponse.json({ ok: false, error: denied.error }, { status: denied.status });
  const path = new URL(req.url).searchParams.get("path") ?? "";
  try {
    return await readVaultDoc(path);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: (e as { code?: number }).code === 503 ? 503 : 502 });
  }
}
