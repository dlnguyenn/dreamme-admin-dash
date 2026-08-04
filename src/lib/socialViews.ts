/**
 * Organic view aggregation for the Overview tab.
 *
 * The awkward bit this module exists to handle: neither publishing vendor
 * exposes a daily view series. Doublespeed's list_posts returns one lifetime
 * `metrics.views` per post and get_account has no analytics at all, so
 * "views gained on day X" has to be derived by snapshotting lifetime totals
 * daily and diffing them (social_post_views, written by
 * /api/cron/sync-post-views).
 *
 * That derivation can't reach backwards — the series starts the day the cron
 * first runs. So there are two daily modes and the UI always says which one
 * it is showing:
 *
 *   "gained"    — LAG() diff over snapshot dates. The real thing. Needs
 *                 enough snapshot history to fill the window.
 *   "published" — lifetime views bucketed by the post's publish date. Correct
 *                 on day one and genuinely useful ("how did the content we
 *                 shipped that day do"), but it is NOT views-per-day and must
 *                 never be labelled as if it were.
 *
 * The pure functions here take rows and return series so they can be unit
 * tested without a database.
 */

export type ViewSourceKey = "doublespeed" | "sideshift";
export type DailyMode = "gained" | "published";

export const VIEW_SOURCES: ViewSourceKey[] = ["doublespeed", "sideshift"];

/** Snapshot days needed before "gained" is preferred over the proxy. */
export const GAINED_MODE_MIN_DAYS = 30;

export interface DailyViewsRow {
  date: string;
  source: string;
  cumulative_views: number | string;
  posts: number;
}

export interface PublishDateRow {
  date: string;
  source: string;
  views: number | string;
  posts: number;
}

/** One chart column: total plus a per-source split. */
export interface DailyPoint {
  date: string;
  total: number;
  bySource: Record<string, number>;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** UTC yyyy-mm-dd, matching clipperSync.todayISODate(). */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of the last `days` UTC dates, oldest first. */
export function dateWindow(days: number, end = new Date()): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(isoDate(d));
  }
  return out;
}

function emptyPoint(date: string): DailyPoint {
  return {
    date,
    total: 0,
    bySource: Object.fromEntries(VIEW_SOURCES.map((s) => [s, 0])),
  };
}

/**
 * Day-over-day gain per source, from cumulative snapshots.
 *
 * The first date in the data has no predecessor, so it is dropped rather than
 * reported as a giant one-day spike — on day one every post's entire lifetime
 * count would land in a single column and make the chart useless.
 *
 * Gains are clamped at zero. A post deleted between snapshots drops the
 * source's cumulative total, and a negative "views gained" is meaningless.
 */
export function gainedSeries(
  rows: DailyViewsRow[],
  window: string[],
): DailyPoint[] {
  // date -> source -> cumulative
  const byDate = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const d = String(r.date).slice(0, 10);
    let m = byDate.get(d);
    if (!m) byDate.set(d, (m = new Map()));
    m.set(r.source, num(r.cumulative_views));
  }

  const dates = [...byDate.keys()].sort();
  const points = new Map<string, DailyPoint>();

  for (let i = 1; i < dates.length; i++) {
    const cur = byDate.get(dates[i])!;
    const prev = byDate.get(dates[i - 1])!;
    const point = emptyPoint(dates[i]);
    for (const source of new Set([...cur.keys(), ...prev.keys()])) {
      const gain = Math.max(0, (cur.get(source) ?? 0) - (prev.get(source) ?? 0));
      point.bySource[source] = gain;
      point.total += gain;
    }
    points.set(dates[i], point);
  }

  return window.map((d) => points.get(d) ?? emptyPoint(d));
}

/** Lifetime views bucketed by publish date — the day-one proxy. */
export function publishedSeries(
  rows: PublishDateRow[],
  window: string[],
): DailyPoint[] {
  const points = new Map<string, DailyPoint>();
  for (const r of rows) {
    const d = String(r.date).slice(0, 10);
    let p = points.get(d);
    if (!p) points.set(d, (p = emptyPoint(d)));
    const v = num(r.views);
    p.bySource[r.source] = (p.bySource[r.source] ?? 0) + v;
    p.total += v;
  }
  return window.map((d) => points.get(d) ?? emptyPoint(d));
}

/**
 * Which daily mode to show. "gained" only once the snapshot history actually
 * covers the window — a half-filled real series looks like a collapse in
 * reach, which is a worse lie than the clearly-labelled proxy.
 */
export function pickDailyMode(
  snapshotSince: string | null,
  windowDays: number,
  now = new Date(),
): { mode: DailyMode; reason: string } {
  if (!snapshotSince) {
    return {
      mode: "published",
      reason: "No daily snapshots yet — showing views by publish date.",
    };
  }
  const days = Math.floor(
    (now.getTime() - new Date(`${snapshotSince}T00:00:00Z`).getTime()) / 86_400_000,
  );
  const needed = Math.min(windowDays, GAINED_MODE_MIN_DAYS);
  if (days < needed) {
    return {
      mode: "published",
      reason: `Daily tracking started ${snapshotSince} (${days}d of ${needed}d) — showing views by publish date until the real series fills in.`,
    };
  }
  return { mode: "gained", reason: `Views gained per day, tracked since ${snapshotSince}.` };
}

export function sumSeries(points: DailyPoint[]): number {
  return points.reduce((s, p) => s + p.total, 0);
}
