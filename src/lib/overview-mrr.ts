/**
 * MRR growth for the Overview: daily MRR changes, the growth rate over 7 and
 * 30 days, and whether that rate is speeding up or slowing down.
 *
 * Source is rc_account_metrics_daily.mrr, which the RevenueCat sync rewrites
 * for the last ~35 days every night from RC's MRR chart, so past days carry
 * RC's final numbers. The newest row is different: the sync runs ~8am UTC, so
 * the row dated "today" is MRR at sync time, not at the end of the day. Every
 * change below is therefore measured between COMPLETE days, and the newest
 * row only ever shows up as the headline number and a "today so far" change.
 *
 * Pure: no fetches here, so tests can feed it rows.
 */

export interface MrrRow {
  date: string;
  mrr: number | null;
  active_subscriptions: number | null;
  synced_at?: string | null;
}

export interface MrrDay {
  date: string;
  mrr: number;
  /** vs the previous day; null on the first day of the window */
  change: number | null;
  /** trailing 7-day average of `change` (needs 7 prior changes) */
  avg7: number | null;
}

export interface MrrGrowthPoint {
  date: string;
  /** MRR growth over the 30 days ending on this date, in percent */
  pct30: number;
}

export interface MrrPeriod {
  days: number;
  change: number;
  pct: number;
  perDay: number;
  /** Same measure over the window right before this one; null without history. */
  priorChange: number | null;
  priorPct: number | null;
}

export interface MrrSection {
  /** Newest MRR (the sync-time snapshot). */
  mrr: number;
  /** Date of that row and when it was synced. */
  asOfDate: string;
  syncedAt: string | null;
  arr: number;
  /** Newest row is the same UTC day as the sync, so it's a partial day. */
  latestIsPartial: boolean;
  /** Change on the last complete day. */
  lastDay: { date: string; change: number; pct: number } | null;
  /** Newest row minus the last complete day, when the newest is partial. */
  todaySoFar: number | null;
  d7: MrrPeriod | null;
  d30: MrrPeriod | null;
  /** MRR per active subscription, now and 30 days before the last complete day. */
  perSub: number | null;
  perSub30dAgo: number | null;
  /** Net change in active subscriptions over the same windows. */
  netSubs7d: number | null;
  netSubs30d: number | null;
  /** Up days out of the last 30 complete days. */
  upDays30: number | null;
  /** Last 60 complete days, oldest first. */
  daily: MrrDay[];
  /** Rolling 30-day growth for the last 60 complete days, oldest first. */
  growth: MrrGrowthPoint[];
  /** Next round $5k and when the last 30 days' pace reaches it. */
  milestone: { target: number; days: number; date: string } | null;
}

const DAY_MS = 86_400_000;
export const MRR_HISTORY_DAYS = 150;
const CHART_DAYS = 60;

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

const finite = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function buildMrr(rows: MrrRow[]): MrrSection | null {
  const clean = rows
    .map((r) => ({
      date: r.date.slice(0, 10),
      mrr: finite(r.mrr),
      subs: finite(r.active_subscriptions),
      syncedAt: r.synced_at ?? null,
    }))
    .filter((r): r is { date: string; mrr: number; subs: number | null; syncedAt: string | null } =>
      r.mrr != null && r.mrr > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  if (clean.length === 0) return null;

  const latest = clean[clean.length - 1];
  const syncedAt =
    clean.reduce<string | null>((m, r) => (r.syncedAt && (!m || r.syncedAt > m) ? r.syncedAt : m), null) ??
    null;
  const latestIsPartial = syncedAt != null && latest.date >= syncedAt.slice(0, 10);
  const complete = latestIsPartial ? clean.slice(0, -1) : clean;

  const byDate = new Map(clean.map((r) => [r.date, r]));
  const mrrOn = (d: string) => byDate.get(d)?.mrr ?? null;
  const subsOn = (d: string) => byDate.get(d)?.subs ?? null;

  const last = complete[complete.length - 1] ?? null;

  const period = (days: number): MrrPeriod | null => {
    if (!last) return null;
    const start = mrrOn(addDays(last.date, -days));
    if (start == null) return null;
    const change = last.mrr - start;
    const priorStart = mrrOn(addDays(last.date, -2 * days));
    const priorChange = priorStart != null ? start - priorStart : null;
    return {
      days,
      change,
      pct: (change / start) * 100,
      perDay: change / days,
      priorChange,
      priorPct: priorChange != null && priorStart ? (priorChange / priorStart) * 100 : null,
    };
  };

  // Daily changes over the chart window, with a trailing 7-day mean.
  const chartFrom = last ? addDays(last.date, -(CHART_DAYS - 1)) : latest.date;
  const daily: MrrDay[] = [];
  for (const r of complete) {
    if (r.date < chartFrom) continue;
    const prev = mrrOn(addDays(r.date, -1));
    const change = prev != null ? r.mrr - prev : null;
    let avg7: number | null = null;
    const back: number[] = [];
    for (let i = 0; i < 7; i++) {
      const a = mrrOn(addDays(r.date, -i));
      const b = mrrOn(addDays(r.date, -i - 1));
      if (a == null || b == null) break;
      back.push(a - b);
    }
    if (back.length === 7) avg7 = back.reduce((s, v) => s + v, 0) / 7;
    daily.push({ date: r.date, mrr: r.mrr, change, avg7 });
  }

  const growth: MrrGrowthPoint[] = [];
  for (const r of complete) {
    if (r.date < chartFrom) continue;
    const base = mrrOn(addDays(r.date, -30));
    if (base) growth.push({ date: r.date, pct30: ((r.mrr - base) / base) * 100 });
  }

  const lastDay = (() => {
    if (!last) return null;
    const prev = mrrOn(addDays(last.date, -1));
    if (prev == null) return null;
    return { date: last.date, change: last.mrr - prev, pct: ((last.mrr - prev) / prev) * 100 };
  })();

  const perSubAt = (d: string | null) => {
    if (!d) return null;
    const m = mrrOn(d);
    const s = subsOn(d);
    return m != null && s ? m / s : null;
  };
  const netSubs = (days: number) => {
    if (!last) return null;
    const a = subsOn(last.date);
    const b = subsOn(addDays(last.date, -days));
    return a != null && b != null ? a - b : null;
  };

  let upDays30: number | null = null;
  if (last) {
    let up = 0;
    let seen = 0;
    for (let i = 0; i < 30; i++) {
      const a = mrrOn(addDays(last.date, -i));
      const b = mrrOn(addDays(last.date, -i - 1));
      if (a == null || b == null) continue;
      seen++;
      if (a > b) up++;
    }
    upDays30 = seen > 0 ? up : null;
  }

  const d30 = period(30);
  let milestone: MrrSection["milestone"] = null;
  if (d30 && d30.perDay > 0) {
    const target = Math.floor(latest.mrr / 5000) * 5000 + 5000;
    const days = Math.ceil((target - latest.mrr) / d30.perDay);
    milestone = { target, days, date: addDays(latest.date, days) };
  }

  return {
    mrr: latest.mrr,
    asOfDate: latest.date,
    syncedAt,
    arr: latest.mrr * 12,
    latestIsPartial,
    lastDay,
    todaySoFar: latestIsPartial && last ? latest.mrr - last.mrr : null,
    d7: period(7),
    d30,
    perSub: latest.subs ? latest.mrr / latest.subs : null,
    perSub30dAgo: last ? perSubAt(addDays(last.date, -30)) : null,
    netSubs7d: netSubs(7),
    netSubs30d: netSubs(30),
    upDays30,
    daily,
    growth,
    milestone,
  };
}
