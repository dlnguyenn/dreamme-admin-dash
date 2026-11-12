/**
 * App Analytics tab (src/lib/app-analytics.ts).
 *
 * GET  — the newest report, or the one named by ?id=, plus the list of every
 *        stored report (`history`, newest first) so an older one can be picked.
 *        `snapshot` is null when nothing has been stored yet.
 * POST — store a new report. Claude sessions call this with the ingest token
 *        after re-running the analysis:
 *        curl -X POST $DAD/api/app-analytics -H "x-dreamme-secret: $INGEST_TOKEN"
 *          -H "content-type: application/json" -d @report.json
 *        Body: { payload: <report>, title?, created_by? }.
 *
 * Same access check as /api/experiments. The table is service-role only, and
 * the figures are kept there because this repo is public.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { spGet, spPost, supportDbConfigured } from "@/lib/support/db";
import type { SnapshotMeta, SnapshotRow } from "@/lib/app-analytics";
import { CreateSnapshot, Report, firstIssue } from "@/lib/app-analytics-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABLE = "app_analytics_snapshots";
const META = "id,as_of,title,created_by,created_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function guard(req: Request): NextResponse | null {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!supportDbConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  }
  return null;
}

const fail = (e: unknown, status = 500) =>
  NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  const wanted = new URL(req.url).searchParams.get("id");
  if (wanted && !UUID.test(wanted)) return fail("invalid id", 400);
  try {
    const history = await spGet<SnapshotMeta[]>(
      `${TABLE}?select=${META}&order=as_of.desc,created_at.desc&limit=50`,
    );
    const pick = wanted ? history.find((h) => h.id === wanted) : history[0];
    if (!pick) {
      if (wanted) return fail("no report with that id", 404);
      return NextResponse.json({ ok: true, snapshot: null, history });
    }
    const [row] = await spGet<SnapshotRow[]>(`${TABLE}?id=eq.${pick.id}&select=${META},payload`);
    if (!row) return fail("no report with that id", 404);
    const parsed = Report.safeParse(row.payload);
    if (!parsed.success) {
      return fail(`The stored report dated ${row.as_of} is not readable (${firstIssue(parsed.error)}).`);
    }
    return NextResponse.json({ ok: true, snapshot: { ...row, payload: parsed.data }, history });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("invalid JSON", 400);
  }
  const parsed = CreateSnapshot.safeParse(body);
  if (!parsed.success) return fail(firstIssue(parsed.error), 400);
  const { payload, title, created_by } = parsed.data;
  try {
    const [row] = await spPost<SnapshotMeta>(TABLE, [
      { as_of: payload.asOf, title: title ?? "", created_by: created_by ?? "", payload },
    ]);
    return NextResponse.json({
      ok: true,
      snapshot: { id: row.id, as_of: row.as_of, title: row.title, created_by: row.created_by, created_at: row.created_at },
    });
  } catch (e) {
    return fail(e);
  }
}
