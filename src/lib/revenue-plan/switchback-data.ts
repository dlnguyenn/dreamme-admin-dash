/**
 * Server side of the Meta holdout tracker: assemble the daily rows for a test
 * (spend per campaign and Meta-reported trials from ad_insights_daily,
 * RevenueCat trial starts from rc_events, the onboarding answer of each iOS
 * trial from user_sources), and raise marketing_alerts rows when a live test's
 * spend drifts off plan. The rules live in switchback.ts.
 */
import { addDays, daysBetween, easternDate, utcSinceForEasternDay } from "./dates";
import { num, sbAll, sbUpsert } from "./db";
import { sourceGroup } from "./sources";
import { HOLDOUT_TESTS, planDeviations, testSpan, type HoldoutTest, type SwitchbackDay } from "./switchback";
import { loadSources, sourceStatus, type SourceStatus } from "./user-sources";
import { fetchTrialStarts } from "./value-per-trial-data";

/** Days of actual spend shown before a test starts (the pre-flight read). */
export const PRE_TEST_DAYS = 14;

export interface SwitchbackRows {
  days: SwitchbackDay[];
  today: string;
  /** Campaign id -> name for every campaign that spent. */
  names: Record<string, string>;
  /** Campaign id -> platform, for unplanned campaigns too. */
  platforms: Record<string, "ios" | "android">;
  sources: SourceStatus | null;
}

export async function fetchSwitchbackRows(t: HoldoutTest, now = new Date()): Promise<SwitchbackRows> {
  const today = easternDate(now);
  const span = testSpan(t);
  const start = span.from < addDays(today, -PRE_TEST_DAYS) ? span.from : addDays(today, -PRE_TEST_DAYS);
  const last = today < span.to ? today : span.to;
  const dates = daysBetween(start, last);

  const [trials, spend, status] = await Promise.all([
    fetchTrialStarts(utcSinceForEasternDay(start)),
    sbAll<{ date: string; campaign_id: string | null; campaign_name: string | null; spend: string | number | null; trial_starts: number | null }>(
      "internal",
      `ad_insights_daily?select=date,campaign_id,campaign_name,spend,trial_starts&date=gte.${start}&date=lte.${last}&order=date.asc,ad_id.asc`,
    ),
    sourceStatus().catch(() => null),
  ]);

  const names: Record<string, string> = {};
  const platforms: Record<string, "ios" | "android"> = {};
  for (const c of t.campaigns) {
    names[c.id] = c.name;
    platforms[c.id] = c.platform;
  }
  const byDay = new Map<string, SwitchbackDay>(
    dates.map((d) => [
      d,
      { date: d, spend: {}, iosSpend: 0, androidSpend: 0, iosTrials: 0, androidTrials: 0, iosMetaReported: 0, iosSaidMeta: null, iosSaidOther: null },
    ]),
  );

  for (const s of spend) {
    const row = byDay.get(String(s.date).slice(0, 10));
    if (!row) continue;
    const id = s.campaign_id ?? "unknown";
    names[id] ??= s.campaign_name ?? id;
    platforms[id] ??= /android/i.test(s.campaign_name ?? "") ? "android" : "ios";
    const v = num(s.spend);
    row.spend[id] = (row.spend[id] ?? 0) + v;
    if (platforms[id] === "android") row.androidSpend += v;
    else {
      row.iosSpend += v;
      row.iosMetaReported += s.trial_starts ?? 0;
    }
  }

  const iosByDay = new Map<string, string[]>();
  for (const tr of trials) {
    const row = byDay.get(easternDate(tr.at));
    if (!row) continue;
    if (tr.store === "APP_STORE") {
      row.iosTrials++;
      const list = iosByDay.get(row.date) ?? [];
      list.push(tr.userId ?? "");
      iosByDay.set(row.date, list);
    } else if (tr.store === "PLAY_STORE") row.androidTrials++;
  }

  if (status) {
    try {
      const map = await loadSources([...iosByDay.values()].flat(), status.backend);
      for (const row of byDay.values()) {
        const ids = iosByDay.get(row.date) ?? [];
        let meta = 0;
        for (const id of ids) if (map.has(id) && sourceGroup(map.get(id)) === "meta") meta++;
        row.iosSaidMeta = meta;
        row.iosSaidOther = ids.length - meta;
      }
    } catch {
      // the survey split is a control, never a reason to fail the page
    }
  }

  return { days: [...byDay.values()], today, names, platforms, sources: status };
}

/** How far back the daily alert pass re-checks (upserts dedupe, so a missed cron day is caught up). */
export const ALERT_LOOKBACK_DAYS = 3;

/**
 * For every live test, write a marketing_alerts row per campaign-day more than
 * 20% off plan (critical over 50%, or any spend on a campaign planned at $0).
 */
export async function writeSwitchbackAlerts(now = new Date()): Promise<{ tests: string[]; alerts: number; messages: string[] }> {
  const today = easternDate(now);
  const live = HOLDOUT_TESTS.filter((t) => t.status === "live" && today >= t.phases[0].from && addDays(testSpan(t).to, 1) >= today);
  const messages: string[] = [];
  let alerts = 0;
  for (const t of live) {
    const { days, names } = await fetchSwitchbackRows(t, now);
    const recent = planDeviations(t, days, today, names).filter((d) => d.date >= addDays(today, -ALERT_LOOKBACK_DAYS));
    if (!recent.length) continue;
    await sbUpsert(
      "marketing_alerts",
      recent.map((d) => ({
        alert_date: d.date,
        scope: "campaign",
        campaign_id: d.campaignId,
        campaign_name: d.campaignName,
        metric: "plan_spend",
        value: Number(d.actual.toFixed(2)),
        baseline: d.planned ?? 0,
        z: null,
        direction: d.actual >= (d.planned ?? 0) ? "spike" : "drop",
        severity: d.severity,
        message: d.message,
      })),
      "alert_date,scope,campaign_id,metric",
    );
    alerts += recent.length;
    messages.push(...recent.map((d) => d.message));
  }
  return { tests: live.map((t) => t.id), alerts, messages };
}
