/**
 * Errors tab: GET the issue list (admin). Issues, 14-day series, headline
 * numbers and whether the tracker is receiving. src/lib/errors/.
 */
import { NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/auth-ingest";
import { MissingTableError, internalConfigured } from "@/lib/revenue-plan/db";
import { errorsConfig } from "@/lib/errors/ingest";
import { listIssues } from "@/lib/errors/store";
import { buildIssueViews, connectionState } from "@/lib/errors/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!checkAdminAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!internalConfigured()) return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  const now = new Date();
  try {
    const { issues, daily } = await listIssues(now);
    const views = buildIssueViews(issues, daily, now);
    const cfg = errorsConfig();
    return NextResponse.json({
      ok: true,
      now: now.toISOString(),
      configured: !!cfg.publicKey,
      projectId: cfg.projectId,
      connection: connectionState(issues, now),
      views,
    });
  } catch (e) {
    if (e instanceof MissingTableError) {
      return NextResponse.json({ ok: false, error: "The error tracker tables are not in the database yet (migration 0123)." }, { status: 500 });
    }
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
