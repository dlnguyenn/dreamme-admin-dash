/**
 * App Analytics live views: Mixpanel charts (src/lib/mixpanel-daily.ts and
 * src/lib/mixpanel-detail.ts).
 *
 * GET  — the live views (Daily, New people, Coming back) for the last ?days=
 *        complete Eastern days (30, 90 or 180; default 30), built from the
 *        stored `mixpanel_daily` and `mixpanel_daily_detail` rows. `views` is
 *        empty until the first sync has run.
 * POST — pull from Mixpanel now: the last 4 days of counts and breakdowns and
 *        the cohorts (three queries). Refused when a sync ran in the last 10
 *        minutes, so a button can't burn Mixpanel's ~60 queries/hour, which
 *        the Overview also uses.
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
import { loadMixpanelDetail, syncMixpanelDetail } from "@/lib/mixpanel-detail";
import { buildDailyView, type DailyRow } from "@/lib/mixpanel-daily-view";

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
    const from = historyStart(days);
    const [stored, detail] = await Promise.all([loadMixpanelDays(from), loadMixpanelDetail(from)]);
    const syncedAt = stored.reduce<string | null>((latest, r) => (!latest || r.synced_at > latest ? r.synced_at : latest), null);
    const detailByDay = new Map(detail.map((d) => [d.day, d]));
    const rows: DailyRow[] = stored.map((r) => ({
      day: r.day,
      events: r.events,
      people: r.people,
      breakdowns: detailByDay.get(r.day)?.breakdowns,
      cohorts: detailByDay.get(r.day)?.cohorts,
    }));
    const { views, through, attention } = buildDailyView(rows, { today: easternDate(new Date()), windowDays: days });
    return NextResponse.json({ ok: true, days, windows: WINDOWS, syncedAt, views, through, attention });
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
    const daily = await syncMixpanelDaily({ days: 4 });
    const detail = await syncMixpanelDetail({ days: 4 });
    return NextResponse.json({ ok: true, ...daily, queries: daily.queries + detail.queries, ms: daily.ms + detail.ms, detail });
  } catch (e) {
    return fail(e);
  }
}
