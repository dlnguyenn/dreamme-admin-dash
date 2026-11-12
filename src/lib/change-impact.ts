/**
 * A readout for changes shipped to everyone.
 *
 * A test with a control group answers itself: RevenueCat compares the arms.
 * A change shipped to everyone has no arm to compare, so the only honest
 * reading is the same metric before and after the day it shipped — and that
 * is a weaker thing. Everything in here is built to keep it weak: it never
 * says a change worked, it names the swing it would take to be sure, and it
 * refuses to report at all on areas where a before and after would be
 * confounded past rescue (ad changes, where spend moves underneath).
 *
 * Pure. Series come from change-impact-data.ts.
 */

export type MetricKey = "cancel_rate" | "cancels_per_day" | "trials_per_day" | "save_redemptions";

export interface MetricSpec {
  label: string;
  /** Which way is good, for wording only — no verdict depends on it. */
  good: "up" | "down";
  /** How a single value reads on its own. */
  format: (n: number) => string;
}

export const METRICS: Record<MetricKey, MetricSpec> = {
  cancel_rate: {
    label: "Cancels per 1,000 subscribers a day",
    good: "down",
    format: (n) => n.toFixed(1),
  },
  cancels_per_day: {
    label: "Cancels a day",
    good: "down",
    format: (n) => n.toFixed(0),
  },
  trials_per_day: {
    label: "Trials started a day",
    good: "up",
    format: (n) => n.toFixed(0),
  },
  save_redemptions: {
    label: "Save offers taken a week",
    good: "up",
    format: (n) => n.toFixed(1),
  },
};

/**
 * What a shipped change in each area is watched on. An area that is not here
 * gets no readout, on purpose:
 *  - ads: spend moves underneath every change, so a before and after says
 *    nothing. The Marketing tabs compare against spend.
 *  - onboarding, lifecycle, attribution, other: no single daily number that a
 *    change there would move on its own.
 */
export const AREA_METRICS: Record<string, MetricKey[]> = {
  retention: ["cancel_rate", "cancels_per_day", "save_redemptions"],
  pricing: ["trials_per_day"],
  paywall: ["trials_per_day"],
};

/** Why an area is deliberately not watched, for the one-line explanation. */
export const AREA_SILENCE: Record<string, string> = {
  ads: "ad spend moves underneath an ads change, so a before and after would say nothing",
};

/** Longest window on each side. */
export const WINDOW_DAYS = 28;
/** Two changes in one area this close together cannot be told apart. */
export const COLLISION_DAYS = 7;
/** Below this many days after, nothing is said. */
export const MIN_AFTER_DAYS = 7;
/** Below this many days before, there is no baseline to compare with. */
export const MIN_BEFORE_DAYS = 14;

export interface DayValue {
  day: string;
  value: number | null;
}

export type ImpactVerdict = "too_early" | "no_baseline" | "no_clear_change" | "worth_a_look";

export interface ChangeImpact {
  metric: MetricKey;
  label: string;
  before: number | null;
  after: number | null;
  changePct: number | null;
  daysBefore: number;
  daysAfter: number;
  verdict: ImpactVerdict;
  /** The reading itself, one short sentence. */
  line: string;
  /**
   * What stops the reading meaning more than it does. Kept apart from `line`
   * so a panel can show the reading and mute the qualifiers, and so the one
   * caveat true of every shipped change is said once per screen, not per row.
   */
  caveats: string[];
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function sd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

function pctChange(before: number, after: number): number | null {
  if (before === 0) return null;
  return ((after - before) / before) * 100;
}

/**
 * Days strictly before and strictly after the change day. The change day
 * itself belongs to neither: a change that ships mid-morning splits it.
 */
function split(series: DayValue[], startDay: string): { before: number[]; after: number[] } {
  const usable = series.filter((d) => d.value != null) as { day: string; value: number }[];
  const before = usable.filter((d) => d.day < startDay).slice(-WINDOW_DAYS).map((d) => d.value);
  const after = usable.filter((d) => d.day > startDay).slice(0, WINDOW_DAYS).map((d) => d.value);
  return { before, after };
}

/**
 * One metric, before against after. "Worth a look" means the after average
 * sits outside what the before period's own day-to-day swing would produce,
 * which is a prompt to look properly — not a result.
 */
export function compareAround(series: DayValue[], startDay: string, metric: MetricKey): ChangeImpact {
  const spec = METRICS[metric];
  const { before, after } = split(series, startDay);
  const base: Omit<ChangeImpact, "verdict" | "line" | "caveats"> = {
    metric,
    label: spec.label,
    before: mean(before),
    after: mean(after),
    changePct: null,
    daysBefore: before.length,
    daysAfter: after.length,
  };

  if (before.length < MIN_BEFORE_DAYS) {
    return { ...base, verdict: "no_baseline", caveats: [], line: `${spec.label}: not enough history before it to compare with.` };
  }
  if (after.length < MIN_AFTER_DAYS) {
    const left = MIN_AFTER_DAYS - after.length;
    const so_far = after.length === 0
      ? "no complete day after it yet"
      : `${after.length} day${after.length === 1 ? "" : "s"} in`;
    return {
      ...base,
      verdict: "too_early",
      caveats: [],
      line: `${spec.label}: ${so_far}. About ${left} more day${left === 1 ? "" : "s"} before it says anything.`,
    };
  }

  const b = mean(before)!;
  const a = mean(after)!;
  const change = pctChange(b, a);
  const s = sd(before);
  // How far the after average could drift on the before period's own swing alone.
  const margin = s != null ? (1.96 * s) / Math.sqrt(after.length) : null;
  const outside = margin != null && Math.abs(a - b) > margin;
  const dir = a > b ? "up" : "down";
  const movement = change == null ? `${spec.format(b)} to ${spec.format(a)}` : `${spec.format(b)} to ${spec.format(a)}, ${dir} ${Math.abs(change).toFixed(0)}%`;

  if (!outside) {
    return {
      ...base,
      changePct: change,
      verdict: "no_clear_change",
      caveats: [],
      line: `${spec.label}: ${movement} over ${after.length} days, inside the usual day-to-day swing.`,
    };
  }
  return {
    ...base,
    changePct: change,
    verdict: "worth_a_look",
    caveats: [],
    line: `${spec.label}: ${movement} over ${after.length} days, further than the usual swing.`,
  };
}

export interface WatchedChange {
  impacts: ChangeImpact[];
  /** Set when the area is deliberately not watched. */
  silent: string | null;
}

/** Every metric an area is watched on, or why it is not watched at all. */
function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

export function watchChange(
  area: string,
  startDay: string | null,
  series: Partial<Record<MetricKey, DayValue[]>>,
  /** Start days of the OTHER shipped changes in the same area. */
  neighbours: string[] = [],
): WatchedChange {
  const silence = AREA_SILENCE[area];
  if (silence) return { impacts: [], silent: silence };
  const keys = AREA_METRICS[area];
  if (!keys || !startDay) return { impacts: [], silent: null };
  // Several changes to one area in the same week share a before and after,
  // so the reading belongs to all of them together. Saying so is the whole
  // difference between a useful number and a misleading one.
  const collided = neighbours.filter((n) => n && daysApart(n, startDay) <= COLLISION_DAYS).length;
  const impacts: ChangeImpact[] = [];
  for (const key of keys) {
    const s = series[key];
    if (!s || !s.length) continue;
    const impact = compareAround(s, startDay, key);
    if (collided > 0 && (impact.verdict === "worth_a_look" || impact.verdict === "no_clear_change")) {
      impact.caveats.push(
        `${collided} other change${collided === 1 ? "" : "s"} to the same area shipped the same week, so this cannot tell them apart.`,
      );
    }
    impacts.push(impact);
  }
  // A rate can fall because its denominator grew. When the rate moves but the
  // raw count does not, the subscriber base did the work, not the change.
  const rate = impacts.find((i) => i.metric === "cancel_rate");
  const raw = impacts.find((i) => i.metric === "cancels_per_day");
  if (rate && raw && rate.verdict === "worth_a_look" && raw.verdict !== "worth_a_look") {
    rate.caveats.push(
      "Cancels a day barely moved, so most of that is the subscriber base growing rather than fewer people leaving.",
    );
  }
  return { impacts, silent: null };
}

const VERDICT_RANK: Record<ImpactVerdict, number> = {
  worth_a_look: 0,
  no_clear_change: 1,
  too_early: 2,
  no_baseline: 3,
};

/** The sharpest reading of the lot. */
export function sharpest(w: WatchedChange): ChangeImpact | null {
  if (!w.impacts.length) return null;
  return [...w.impacts].sort((x, y) => VERDICT_RANK[x.verdict] - VERDICT_RANK[y.verdict])[0];
}

/** The single line a panel row shows: the sharpest reading with its caveats, or why there is none. */
export function headlineImpact(w: WatchedChange): string | null {
  if (w.silent) return `Not watched here: ${w.silent}.`;
  const top = sharpest(w);
  if (!top) return null;
  return [top.line, ...top.caveats].join(" ");
}
