/**
 * Nightly pull of Mixpanel's daily event counts into `mixpanel_daily`
 * (src/lib/mixpanel-daily.ts), for App Analytics > Daily.
 *
 * Vercel cron, 09:20 UTC (after the Eastern day has ended, summer or winter):
 * re-pulls the last 4 Eastern days in one Mixpanel query, so events phones
 * sent late are picked up. ?days=N pulls further back (the first backfill;
 * one query per 31 days, at most 400 days).
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { supportDbConfigured } from "@/lib/support/db";
import { mixpanelConfigured } from "@/lib/vendors/mixpanel";
import { MAX_SYNC_DAYS, syncMixpanelDaily } from "@/lib/mixpanel-daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!supportDbConfigured() || !mixpanelConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase service role or Mixpanel service account not configured" }, { status: 500 });
  }
  const asked = Number(new URL(req.url).searchParams.get("days"));
  const days = Number.isFinite(asked) && asked >= 1 ? Math.min(MAX_SYNC_DAYS, Math.round(asked)) : 4;
  try {
    return NextResponse.json({ ok: true, ...(await syncMixpanelDaily({ days })) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
