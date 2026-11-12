/**
 * App Analytics > Daily: the Mixpanel pull (server only).
 *
 * One JQL query returns, for every Eastern day in a range, each event's users
 * and totals (overall, iOS, Android) and how many people did anything. The
 * rows go into `mixpanel_daily`; the tab reads them back through
 * mixpanel-daily-view.ts. One query a day keeps this far inside Mixpanel's
 * ~60 queries/hour, which the Overview also draws on.
 *
 * Checked 2026-11-11 against Mixpanel's own daily counts (/api/query/events)
 * for four events over three days: users matched exactly, and totals differed
 * only by a handful of late-arriving events.
 */
import { addDays, easternDate } from "@/lib/revenue-plan/dates";
import { spGet, spPost } from "@/lib/support/db";
import { jql } from "@/lib/vendors/mixpanel";
import type { DailyRow, EventCounts, PeopleCounts } from "@/lib/mixpanel-daily-view";

const TABLE = "mixpanel_daily";

/**
 * Events left out of both people counts ("did something" and "had a screen
 * up"). `rc_` events (matched by prefix in the script) and push sends come
 * from servers; a health sync can run while the phone is in a pocket.
 *
 * The two app-open events are left out for a different reason: they come and
 * go. `app_opened` was removed in August 2026 and `app_session_started`
 * arrives with a later release, so counting either would put a cliff or a
 * jump in the people charts on the day the app changed, not the day people
 * did. Sessions get their own chart instead.
 */
export const NOT_IN_APP = [
  "notification_sent",
  "health_sync_failed",
  "health_sync_completed",
  "health_access_issue_detected",
  "app_opened",
  "app_session_started",
];

/** Events that fire when a screen appears, without a tap. They count as "seen", not "by hand". */
export const IMPRESSIONS = [
  "paywall_viewed",
  "Goal Refresh Shown",
  "reef_makeover_popup_shown",
  "return_offer_shown",
  "review_onboarding_arm_assigned",
];

/**
 * JQL works in UTC, so the script turns each event's time into a US Eastern
 * day itself (the same day boundary as the Overview's trial counts). Per user
 * and day it counts each event, then per day it adds the users up.
 */
const SCRIPT = `
function easternDay(ms) {
  var d = new Date(ms);
  var y = d.getUTCFullYear();
  var mar = new Date(Date.UTC(y, 2, 1));
  var start = Date.UTC(y, 2, 1 + ((7 - mar.getUTCDay()) % 7) + 7, 7);
  var nov = new Date(Date.UTC(y, 10, 1));
  var end = Date.UTC(y, 10, 1 + ((7 - nov.getUTCDay()) % 7), 6);
  var offset = ms >= start && ms < end ? 4 : 5;
  return new Date(ms - offset * 3600000).toISOString().slice(0, 10);
}
function main() {
  var notInApp = {}, impression = {}, i;
  for (i = 0; i < params.notInApp.length; i++) notInApp[params.notInApp[i]] = true;
  for (i = 0; i < params.impressions.length; i++) impression[params.impressions[i]] = true;
  return Events({ from_date: params.from, to_date: params.to })
    .groupByUser([function (e) { return easternDay(e.time); }], function (state, events) {
      state = state || { ev: {}, act: [0, 0, 0], seen: [0, 0, 0] };
      for (var k = 0; k < events.length; k++) {
        var e = events[k];
        var c = state.ev[e.name] || (state.ev[e.name] = [0, 0, 0]);
        c[0]++;
        var plat = e.properties.platform;
        var p = plat === "ios" ? 1 : plat === "android" ? 2 : 0;
        if (p) c[p]++;
        if (notInApp[e.name] || e.name.indexOf("rc_") === 0) continue;
        state.seen[0] = 1;
        if (p) state.seen[p] = 1;
        if (!impression[e.name]) {
          state.act[0] = 1;
          if (p) state.act[p] = 1;
        }
      }
      return state;
    })
    .groupBy(["key.1"], function (accs, items) {
      var out = { ev: {}, act: [0, 0, 0], seen: [0, 0, 0] }, q, n;
      for (var a = 0; a < accs.length; a++) {
        var acc = accs[a];
        for (n in acc.ev) {
          var t = out.ev[n] || (out.ev[n] = [0, 0, 0, 0, 0, 0]);
          for (q = 0; q < 6; q++) t[q] += acc.ev[n][q];
        }
        for (q = 0; q < 3; q++) { out.act[q] += acc.act[q]; out.seen[q] += acc.seen[q]; }
      }
      for (var j = 0; j < items.length; j++) {
        var v = items[j].value;
        for (n in v.ev) {
          var c = v.ev[n];
          var o = out.ev[n] || (out.ev[n] = [0, 0, 0, 0, 0, 0]);
          o[0]++; o[1] += c[0];
          if (c[1]) { o[2]++; o[3] += c[1]; }
          if (c[2]) { o[4]++; o[5] += c[2]; }
        }
        for (q = 0; q < 3; q++) { out.act[q] += v.act[q]; out.seen[q] += v.seen[q]; }
      }
      return out;
    });
}`;

interface JqlDay {
  key: [string];
  value: { ev: Record<string, EventCounts>; act: PeopleCounts; seen: PeopleCounts };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every Eastern day from `from` to `to` (inclusive). The UTC range runs one
 * day past `to` so the last Eastern evening is covered; the partial days that
 * come back at either edge are dropped.
 */
export async function fetchMixpanelDays(from: string, to: string): Promise<DailyRow[]> {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) throw new Error("bad day range");
  const rows = await jql<JqlDay>(SCRIPT, {
    from,
    to: addDays(to, 1),
    notInApp: NOT_IN_APP,
    impressions: IMPRESSIONS,
  });
  return rows
    .map((r) => ({
      day: r.key[0],
      events: r.value.ev ?? {},
      people: { act: r.value.act, seen: r.value.seen },
    }))
    .filter((r) => r.day >= from && r.day <= to)
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** Longest range per query: keeps each JQL run to about a second or two. */
const CHUNK_DAYS = 31;
export const MAX_SYNC_DAYS = 400;

export interface SyncResult {
  from: string;
  to: string;
  days: number;
  queries: number;
  ms: number;
}

/**
 * Pull the last `days` Eastern days (today included, as a partial day the view
 * leaves out) and upsert them. The nightly run asks for 4: the day that just
 * ended plus the three before it, to pick up events phones sent late.
 */
export async function syncMixpanelDaily(opts: { days?: number; now?: Date } = {}): Promise<SyncResult> {
  const t0 = Date.now();
  const days = Math.min(MAX_SYNC_DAYS, Math.max(1, Math.round(opts.days ?? 4)));
  const to = easternDate(opts.now ?? new Date());
  const from = addDays(to, -(days - 1));
  let queries = 0;
  let stored = 0;
  for (let start = from; start <= to; start = addDays(start, CHUNK_DAYS)) {
    const end = addDays(start, CHUNK_DAYS - 1) < to ? addDays(start, CHUNK_DAYS - 1) : to;
    const rows = await fetchMixpanelDays(start, end);
    queries++;
    if (rows.length) {
      const synced_at = new Date().toISOString();
      await spPost(
        TABLE,
        rows.map((r) => ({ ...r, synced_at })),
        { onConflict: "day", resolution: "merge" },
      );
      stored += rows.length;
    }
  }
  return { from, to, days: stored, queries, ms: Date.now() - t0 };
}

export interface StoredDay extends DailyRow {
  synced_at: string;
}

/** Stored days from `from` on, oldest first. Each row is a few KB, so 400 rows is well under a page. */
export async function loadMixpanelDays(from: string): Promise<StoredDay[]> {
  if (!ISO_DAY.test(from)) throw new Error("bad day");
  return spGet<StoredDay[]>(`${TABLE}?day=gte.${from}&select=day,events,people,synced_at&order=day.asc&limit=1000`);
}

/** When the newest sync ran, or null when the table is empty. */
export async function lastMixpanelSync(): Promise<string | null> {
  const rows = await spGet<{ synced_at: string }[]>(`${TABLE}?select=synced_at&order=synced_at.desc&limit=1`);
  return rows[0]?.synced_at ?? null;
}

/** Days of history to load for a chart window: the window plus the 5 weeks the comparisons look back over. */
export function historyStart(windowDays: number, now = new Date()): string {
  return addDays(easternDate(now), -(windowDays + 36));
}
