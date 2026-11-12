/**
 * App Analytics > New people and Coming back: two more Mixpanel pulls (server
 * only), stored in `mixpanel_daily_detail` beside the per-event counts.
 *
 * 1. Breakdowns: a handful of events split by one property each, per Eastern
 *    day. Onboarding steps by screen, the "where did you hear about us" answer,
 *    which paywall a trial came from, and so on. One query for the last 4 days.
 * 2. Cohorts: for everyone who signed up or started a trial on a day, whether
 *    they did something by hand after each wait, and how many of a trial's
 *    first 7 days they were active. One query over the last 100 days, because
 *    a cohort's 8-weeks-later figure only settles 9 weeks after the day.
 *
 * With the daily counts that is three queries a morning, against Mixpanel's
 * ~60 an hour. The rows come back through mixpanel-daily-view.ts.
 */
import { addDays, easternDate } from "@/lib/revenue-plan/dates";
import { spGet, spPost } from "@/lib/support/db";
import { jql } from "@/lib/vendors/mixpanel";
import { EASTERN_DAY_JS, IMPRESSIONS, MAX_SYNC_DAYS, NOT_IN_APP } from "@/lib/mixpanel-daily";
import {
  BREAKDOWNS,
  STEP_KEY,
  STEP_RANK_KEY,
  WAITS,
  type Breakdowns,
  type CohortCounts,
  type DayCohorts,
  type ValueCounts,
} from "@/lib/mixpanel-daily-view";

const TABLE = "mixpanel_daily_detail";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A property with more distinct values than this is not one to chart; the rest are dropped. */
const MAX_VALUES = 40;

/**
 * Per user and day: how many times each value of each wanted property came
 * up, and the position at which the user first met each onboarding screen
 * (JQL hands a user's events over in time order). Per day: people and events
 * per value, plus people and summed positions per screen.
 */
const BREAKDOWN_SCRIPT = `${EASTERN_DAY_JS}
function main() {
  var wanted = {}, i;
  for (i = 0; i < params.breakdowns.length; i++) {
    var b = params.breakdowns[i];
    (wanted[b[0]] || (wanted[b[0]] = [])).push(b[1]);
  }
  var selectors = [];
  for (var name in wanted) selectors.push({ event: name });
  return Events({ from_date: params.from, to_date: params.to, event_selectors: selectors })
    .groupByUser([function (e) { return easternDay(e.time); }], function (state, events) {
      state = state || { bd: {}, seq: 0, rank: {} };
      for (var k = 0; k < events.length; k++) {
        var e = events[k], props = wanted[e.name];
        if (!props) continue;
        for (var p = 0; p < props.length; p++) {
          var val = e.properties[props[p]];
          if (val == null || val === "") continue;
          val = String(val).slice(0, 48);
          var key = e.name + "|" + props[p];
          var m = state.bd[key] || (state.bd[key] = {});
          m[val] = (m[val] || 0) + 1;
          if (key === params.rankKey && !state.rank[val]) state.rank[val] = ++state.seq;
        }
      }
      return state;
    })
    .groupBy(["key.1"], function (accs, items) {
      var out = { bd: {}, rank: {} }, key, val, r;
      function add(key, val, users, total) {
        var m = out.bd[key] || (out.bd[key] = {});
        var c = m[val] || (m[val] = [0, 0]);
        c[0] += users; c[1] += total;
      }
      for (var a = 0; a < accs.length; a++) {
        for (key in accs[a].bd) for (val in accs[a].bd[key]) add(key, val, accs[a].bd[key][val][0], accs[a].bd[key][val][1]);
        for (val in accs[a].rank) { r = out.rank[val] || (out.rank[val] = [0, 0]); r[0] += accs[a].rank[val][0]; r[1] += accs[a].rank[val][1]; }
      }
      for (var j = 0; j < items.length; j++) {
        var v = items[j].value;
        for (key in v.bd) for (val in v.bd[key]) add(key, val, 1, v.bd[key][val]);
        for (val in v.rank) { r = out.rank[val] || (out.rank[val] = [0, 0]); r[0]++; r[1] += v.rank[val]; }
      }
      return out;
    });
}`;

interface JqlBreakdownDay {
  key: [string];
  value: { bd: Breakdowns; rank: Record<string, ValueCounts> };
}

/** The `MAX_VALUES` values with the most people. */
function trimValues(values: Record<string, ValueCounts>): Record<string, ValueCounts> {
  const entries = Object.entries(values);
  if (entries.length <= MAX_VALUES) return values;
  return Object.fromEntries(entries.sort((a, b) => b[1][0] - a[1][0]).slice(0, MAX_VALUES));
}

export interface BreakdownDay {
  day: string;
  breakdowns: Breakdowns;
}

/** Every Eastern day from `from` to `to` (inclusive); the UTC range runs a day long and the edge days are dropped. */
export async function fetchBreakdownDays(from: string, to: string): Promise<BreakdownDay[]> {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) throw new Error("bad day range");
  const rows = await jql<JqlBreakdownDay>(BREAKDOWN_SCRIPT, {
    from,
    to: addDays(to, 1),
    breakdowns: BREAKDOWNS,
    rankKey: STEP_KEY,
  });
  return rows
    .map((r) => {
      const breakdowns: Breakdowns = {};
      for (const [key, values] of Object.entries(r.value.bd ?? {})) breakdowns[key] = trimValues(values);
      if (r.value.rank && Object.keys(r.value.rank).length) breakdowns[STEP_RANK_KEY] = trimValues(r.value.rank);
      return { day: r.key[0], breakdowns };
    })
    .filter((r) => r.day >= from && r.day <= to)
    .sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Per user: the first day they signed up, the first day they started a trial,
 * and every day they did something by hand (the same test as the Daily view's
 * people count). Then per cohort day: how many came back at each wait and,
 * for trials, how many of the first 7 days each person was active.
 */
const COHORT_SCRIPT = `${EASTERN_DAY_JS}
function plusDays(day, n) {
  return new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}
function main() {
  var notInApp = {}, impression = {}, i;
  for (i = 0; i < params.notInApp.length; i++) notInApp[params.notInApp[i]] = true;
  for (i = 0; i < params.impressions.length; i++) impression[params.impressions[i]] = true;
  var W = params.waits;
  function cameBack(days, start) {
    var f = [], w, o;
    for (w = 0; w < W.length; w++) {
      var hit = 0;
      for (o = W[w][0]; o <= W[w][1] && !hit; o++) if (days[plusDays(start, o)]) hit = 1;
      f.push(hit);
    }
    return f;
  }
  return Events({ from_date: params.from, to_date: params.to })
    .groupByUser(function (state, events) {
      state = state || { s: null, t: null, d: {} };
      for (var k = 0; k < events.length; k++) {
        var e = events[k];
        if (notInApp[e.name] || impression[e.name] || e.name.indexOf("rc_") === 0) continue;
        var day = easternDay(e.time);
        if (e.name === "sign_up_completed" && (!state.s || day < state.s)) state.s = day;
        if (e.name === "trial_started" && (!state.t || day < state.t)) state.t = day;
        state.d[day] = 1;
      }
      return state;
    })
    .filter(function (u) { return u.value.s || u.value.t; })
    .map(function (u) {
      var v = u.value, out = [];
      if (v.s) out.push({ kind: "signup", day: v.s, f: cameBack(v.d, v.s), n: 0 });
      if (v.t) {
        var n = 0;
        for (var o = 0; o < 7; o++) if (v.d[plusDays(v.t, o)]) n++;
        out.push({ kind: "trial", day: v.t, f: cameBack(v.d, v.t), n: n });
      }
      return out;
    })
    .flatten()
    .groupBy(["kind", "day"], function (accs, items) {
      var out = { n: 0, f: [], h: [0, 0, 0, 0, 0, 0, 0, 0] }, q;
      for (q = 0; q < W.length; q++) out.f.push(0);
      for (var a = 0; a < accs.length; a++) {
        out.n += accs[a].n;
        for (q = 0; q < W.length; q++) out.f[q] += accs[a].f[q];
        for (q = 0; q < 8; q++) out.h[q] += accs[a].h[q];
      }
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        out.n++;
        for (q = 0; q < W.length; q++) out.f[q] += it.f[q];
        if (it.kind === "trial") out.h[it.n]++;
      }
      return out;
    });
}`;

interface JqlCohort {
  key: ["signup" | "trial", string];
  value: { n: number; f: number[]; h: number[] };
}

export interface CohortDay {
  day: string;
  cohorts: DayCohorts;
}

/**
 * Cohorts for every Eastern day from `from` to `through` (the last complete
 * day). Someone who signed up before `from` is in no cohort here, so each
 * day's figures are whole; a wait that has not passed yet is left for the
 * view to hide (it knows `through`).
 */
export async function fetchCohortDays(from: string, through: string): Promise<CohortDay[]> {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(through) || from > through) throw new Error("bad day range");
  const rows = await jql<JqlCohort>(COHORT_SCRIPT, {
    from,
    to: addDays(through, 2),
    notInApp: NOT_IN_APP,
    impressions: IMPRESSIONS,
    waits: WAITS.map((w) => [w.from, w.to]),
  });
  const byDay = new Map<string, DayCohorts>();
  for (const r of rows) {
    const [kind, day] = r.key;
    if (day < from || day > through) continue;
    const counts: CohortCounts = kind === "trial" ? { n: r.value.n, f: r.value.f, h: r.value.h } : { n: r.value.n, f: r.value.f };
    const entry = byDay.get(day) ?? { through };
    entry[kind] = counts;
    byDay.set(day, entry);
  }
  return [...byDay.entries()].map(([day, cohorts]) => ({ day, cohorts })).sort((a, b) => a.day.localeCompare(b.day));
}

/** Days per breakdown query: these rows are small, so a quarter at a time is fine. */
const BREAKDOWN_CHUNK_DAYS = 93;
/** The nightly cohort scan: the longest wait (9 weeks) plus a month of slack for late events. */
export const COHORT_SCAN_DAYS = 100;

export interface DetailSyncResult {
  breakdownDays: number;
  cohortDays: number;
  queries: number;
  ms: number;
}

/**
 * Pull the breakdowns for the last `days` Eastern days and the cohorts for
 * the last 100 (or `days`, when that is more: the first backfill).
 */
export async function syncMixpanelDetail(opts: { days?: number; now?: Date } = {}): Promise<DetailSyncResult> {
  const t0 = Date.now();
  const days = Math.min(MAX_SYNC_DAYS, Math.max(1, Math.round(opts.days ?? 4)));
  const today = easternDate(opts.now ?? new Date());
  const from = addDays(today, -(days - 1));
  let queries = 0;
  let breakdownDays = 0;

  for (let start = from; start <= today; start = addDays(start, BREAKDOWN_CHUNK_DAYS)) {
    const last = addDays(start, BREAKDOWN_CHUNK_DAYS - 1);
    const rows = await fetchBreakdownDays(start, last < today ? last : today);
    queries++;
    if (rows.length) {
      const synced_at = new Date().toISOString();
      await spPost(
        TABLE,
        rows.map((r) => ({ ...r, synced_at })),
        { onConflict: "day", resolution: "merge" },
      );
      breakdownDays += rows.length;
    }
  }

  const through = addDays(today, -1);
  const cohortFrom = addDays(today, -Math.max(days, COHORT_SCAN_DAYS));
  const cohorts = await fetchCohortDays(cohortFrom, through);
  queries++;
  if (cohorts.length) {
    const synced_at = new Date().toISOString();
    await spPost(
      TABLE,
      cohorts.map((r) => ({ ...r, synced_at })),
      { onConflict: "day", resolution: "merge" },
    );
  }
  return { breakdownDays, cohortDays: cohorts.length, queries, ms: Date.now() - t0 };
}

export interface StoredDetail {
  day: string;
  breakdowns: Breakdowns | null;
  cohorts: DayCohorts | null;
}

/** Stored detail rows from `from` on, oldest first. */
export async function loadMixpanelDetail(from: string): Promise<StoredDetail[]> {
  if (!ISO_DAY.test(from)) throw new Error("bad day");
  return spGet<StoredDetail[]>(`${TABLE}?day=gte.${from}&select=day,breakdowns,cohorts&order=day.asc&limit=1000`);
}
