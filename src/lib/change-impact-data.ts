/**
 * The daily series the shipped-change readout compares (lib/change-impact.ts).
 *
 * Fetched once per digest run and shared by every change, because each change
 * only picks a window out of them. Eastern days throughout, to match the rest
 * of the dash.
 *
 * Counting happens in the database (migration 0115: rc_cancels_daily,
 * rc_save_offers_daily) because PostgREST caps a plain select at 1,000 rows,
 * and 160 days of cancellations is several times that — it would have come
 * back truncated and read as a collapse.
 *
 * The newest day is dropped from every series: RevenueCat's daily metrics row
 * for today is a partial-day snapshot, and a half day reads as a collapse too.
 */
import { sbGet } from "@/lib/revenue-plan/db";
import type { DayValue, MetricKey } from "@/lib/change-impact";

/** Enough history for a 28-day baseline behind the oldest change worth watching. */
const HISTORY_DAYS = 160;
/** Save offers run at a few a month, so they are read as a rolling week. */
const SAVE_WINDOW_DAYS = 7;

function dropNewest(rows: DayValue[]): DayValue[] {
  if (rows.length < 2) return rows;
  const newest = rows.reduce((a, b) => (a > b.day ? a : b.day), "");
  return rows.filter((r) => r.day !== newest);
}

/**
 * Cancels per 1,000 active subscribers. A rate, not a count: the subscriber
 * base grows a few percent a month, so raw cancels drift up on their own.
 */
async function cancelRate(fromDay: string): Promise<DayValue[]> {
  const [metrics, cancels] = await Promise.all([
    sbGet<{ date: string; active_subscriptions: number | null }[]>(
      "internal",
      `rc_account_metrics_daily?select=date,active_subscriptions&date=gte.${fromDay}&order=date.asc&limit=400`,
    ),
    sbGet<{ day: string; cancels: number }[]>(
      "internal",
      `rc_cancels_daily?select=day,cancels&day=gte.${fromDay}&order=day.asc&limit=400`,
    ),
  ]);
  const perDay = new Map(cancels.map((c) => [c.day, c.cancels]));
  return dropNewest(
    metrics.map((m) => ({
      day: m.date,
      value: m.active_subscriptions && m.active_subscriptions > 0
        ? ((perDay.get(m.date) ?? 0) / m.active_subscriptions) * 1000
        : null,
    })),
  );
}

/** Raw cancels a day, the cross-check on the rate when the base is growing. */
async function cancelsPerDay(fromDay: string): Promise<DayValue[]> {
  const rows = await sbGet<{ day: string; cancels: number }[]>(
    "internal",
    `rc_cancels_daily?select=day,cancels&day=gte.${fromDay}&order=day.asc&limit=400`,
  );
  return dropNewest(rows.map((r) => ({ day: r.day, value: r.cancels })));
}

/** Trials started a day, from the table that holds complete days. */
async function trialsPerDay(fromDay: string): Promise<DayValue[]> {
  const rows = await sbGet<{ date: string; trial_starts: number | null }[]>(
    "internal",
    `rc_trial_starts_daily?select=date,trial_starts&date=gte.${fromDay}&order=date.asc&limit=400`,
  );
  return dropNewest(rows.map((r) => ({ day: r.date, value: r.trial_starts ?? null })));
}

/**
 * Save and win-back offers actually taken, as a rolling week. A daily figure
 * would be zero nearly every day and compare nothing.
 */
async function saveRedemptions(fromDay: string, today: string): Promise<DayValue[]> {
  const rows = await sbGet<{ day: string; redemptions: number }[]>(
    "internal",
    `rc_save_offers_daily?select=day,redemptions&day=gte.${fromDay}&order=day.asc&limit=400`,
  );
  const perDay = new Map(rows.map((r) => [r.day, r.redemptions]));
  const days = allDays(fromDay, today);
  return dropNewest(
    days.map((day, i) => {
      const window = days.slice(Math.max(0, i - (SAVE_WINDOW_DAYS - 1)), i + 1);
      const whole = window.length === SAVE_WINDOW_DAYS;
      return {
        day,
        value: whole ? window.reduce((a, d) => a + (perDay.get(d) ?? 0), 0) : null,
      };
    }),
  );
}

export function easternDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function allDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export type ImpactSeries = Partial<Record<MetricKey, DayValue[]>>;

/**
 * Every series, each failing on its own: a metric that cannot be fetched is
 * simply absent, and the changes that wanted it say they have no reading
 * rather than the whole digest falling over.
 */
export async function fetchImpactSeries(now = new Date()): Promise<{ series: ImpactSeries; errors: string[] }> {
  const today = easternDay(now.toISOString());
  const fromDay = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const errors: string[] = [];
  const series: ImpactSeries = {};
  const jobs: [MetricKey, Promise<DayValue[]>][] = [
    ["cancel_rate", cancelRate(fromDay)],
    ["cancels_per_day", cancelsPerDay(fromDay)],
    ["trials_per_day", trialsPerDay(fromDay)],
    ["save_redemptions", saveRedemptions(fromDay, today)],
  ];
  for (const [key, job] of jobs) {
    try {
      series[key] = await job;
    } catch (e) {
      errors.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { series, errors };
}
