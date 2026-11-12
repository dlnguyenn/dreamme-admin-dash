/**
 * App Analytics > Daily: live Mixpanel charts (src/lib/mixpanel-daily.ts).
 *
 * GET  — the Daily view for the last ?days= complete Eastern days (30, 90 or
 *        180; default 30), built from the stored `mixpanel_daily` rows.
 *        `view` is null until the first sync has run.
 * POST — pull the last 4 days from Mixpanel now (one query). Refused when a
 *        sync ran in the last 10 minutes, so a button can't burn Mixpanel's
 *        ~60 queries/hour, which the Overview also uses.
 *
 * The nightly pull is /api/cron/sync-mixpanel. Same access check as
 * /api/app-analytics.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { supportDbConfigured } from "@/lib/support/db";
import { easternDate } from "@/lib/revenue-plan/dates";
import { mixpanelConfigured } from "@/lib/vendors/mixpanel";
import { historyStart, lastMixpanelSync, loadMixpanelDays, syncMixpanelDaily } from "@/lib/mixpanel-daily";
import { buildDailyView } from "@/lib/mixpanel-daily-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WINDOWS = [30, 90, 180];
const COOLDOWN_MS = 10 * 60_000;

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
  const asked = Number(new URL(req.url).searchParams.get("days"));
  const days = WINDOWS.includes(asked) ? asked : 30;
  try {
    const rows = await loadMixpanelDays(historyStart(days));
    const syncedAt = rows.reduce<string | null>((latest, r) => (!latest || r.synced_at > latest ? r.synced_at : latest), null);
    const built = buildDailyView(rows, { today: easternDate(new Date()), windowDays: days });
    return NextResponse.json({ ok: true, days, windows: WINDOWS, syncedAt, ...built });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  if (!mixpanelConfigured()) return fail("Mixpanel service account not configured");
  try {
    const last = await lastMixpanelSync();
    if (last && Date.now() - Date.parse(last) < COOLDOWN_MS) {
      const wait = Math.ceil((COOLDOWN_MS - (Date.now() - Date.parse(last))) / 60_000);
      return fail(`Mixpanel was pulled a few minutes ago. Try again in ${wait} minute${wait === 1 ? "" : "s"}.`, 429);
    }
    return NextResponse.json({ ok: true, ...(await syncMixpanelDaily({ days: 4 })) });
  } catch (e) {
    return fail(e);
  }
}
