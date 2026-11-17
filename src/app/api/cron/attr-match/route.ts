/**
 * Daily attribution re-sweep — re-runs the click↔install matcher over the
 * last 7 days of unmatched installs. Covers the races inline matching
 * can't: a click row landing after the install ping (after() write vs
 * ingest), or matcher downtime. Idempotent: verdicts are only written
 * where matched_click_id is still null.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { rematchRecentInstalls } from "@/lib/attr-installs";
import { attrJobsEnabled } from "@/lib/attr-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!attrJobsEnabled()) {
    return NextResponse.json({ ok: true, skipped: "ATTR_JOBS_ENABLED is not 1 (outlier still runs this job)" });
  }
  try {
    const result = await rematchRecentInstalls(200);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
