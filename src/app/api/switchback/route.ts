/**
 * GET /api/switchback?test=<id> — one Meta holdout test (src/lib/revenue-plan/switchback.ts):
 * daily spend per campaign against plan, RevenueCat iOS and Android trials,
 * Meta-reported trials, the onboarding-survey split, and the running verdict.
 * Without ?test it opens the live test, else the next draft. Feeds the
 * Meta Switchback tab; the daily email cron (/api/cron/step-down-report) reuses it.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { internalConfigured } from "@/lib/revenue-plan/db";
import { defaultTest, findTest } from "@/lib/revenue-plan/switchback";
import { POLICY, cached, wantsFresh } from "@/lib/dad-cache";
import { loadSwitchback, switchbackKey } from "@/lib/dad-cache-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!internalConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  }
  const id = new URL(req.url).searchParams.get("test");
  const test = id ? findTest(id) : defaultTest();
  if (!test) return NextResponse.json({ ok: false, error: `unknown test ${id}` }, { status: 404 });
  try {
    const { value, meta } = await cached(switchbackKey(test.id), POLICY.daily, () => loadSwitchback(test), {
      force: wantsFresh(req),
    });
    return NextResponse.json({ ok: true, ...value, cache: meta });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
