/**
 * App Analytics live views: turns stored Mixpanel days into the views the tab
 * draws (pure, safe for tests and the client bundle).
 *
 * Input is one row per Eastern day: the per-event counts (migration 0111)
 * joined with that day's property breakdowns and cohorts (migration 0112).
 * Output is three ordinary App Analytics views:
 *
 *   Daily        what people do each day, and whether every event still arrives
 *   New people   onboarding to trial: by phone, by screen, by where they came from
 *   Coming back  whether sign-ups and trial starters return, by the day they began
 *
 * The "is every event still arriving" table exists because `app_opened` was
 * removed in August and nobody noticed for three months.
 */
import {
  formatNumber,
  shortDateLabel,
  type Block,
  type DailySeries,
  type Section,
  type Series,
  type StatItem,
  type TableCell,
  type Tone,
  type View,
} from "@/lib/app-analytics";

/** users, total, iOS users, iOS total, Android users, Android total */
export type EventCounts = [number, number, number, number, number, number];
/** all, iOS, Android */
export type PeopleCounts = [number, number, number];
/** users, total for one value of a property */
export type ValueCounts = [number, number];
/** "<event>|<property>" -> value -> counts */
export type Breakdowns = Record<string, Record<string, ValueCounts>>;

export interface CohortCounts {
  /** People in the cohort. */
  n: number;
  /** How many came back at each wait in WAITS. */
  f: number[];
  /** Trial cohorts only: people by how many of the first 7 days they were active (index = days). */
  h?: number[];
}

export interface DayCohorts {
  /** The last complete day when this was counted; a wait ending after it is not settled. */
  through?: string;
  signup?: CohortCounts;
  trial?: CohortCounts;
}

export interface DailyRow {
  day: string;
  events: Record<string, EventCounts>;
  people: { act?: PeopleCounts; seen?: PeopleCounts };
  breakdowns?: Breakdowns | null;
  cohorts?: DayCohorts | null;
}

const DAY_MS = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(utc(d) + n * DAY_MS).toISOString().slice(0, 10);

/** The live views' ids. A stored report can't use them (the tab shows the live ones). */
export const DAILY_VIEW_ID = "daily";
export const NEW_PEOPLE_VIEW_ID = "new-people";
export const COMING_BACK_VIEW_ID = "coming-back";
export const LIVE_VIEWS = [
  { id: DAILY_VIEW_ID, label: "Daily" },
  { id: NEW_PEOPLE_VIEW_ID, label: "New people" },
  { id: COMING_BACK_VIEW_ID, label: "Coming back" },
];

/** How far back the comparisons look: the last 7 days against the 28 before them. */
export const RECENT_DAYS = 7;
export const BASE_DAYS = 28;
/** The cohort charts never show fewer days than this: an 8-weeks-later figure needs 9 weeks to exist. */
export const LONG_WINDOW_DAYS = 90;

/** The event properties the detail sync splits by (src/lib/mixpanel-detail.ts). */
export const BREAKDOWNS: [event: string, property: string][] = [
  ["onboarding_step_completed", "step_name"],
  ["onboarding_referral_source_selected", "source"],
  ["trial_started", "referral_source"],
  ["trial_started", "paywall_source"],
  ["trial_started", "plan_type"],
  ["paywall_viewed", "source"],
  ["Goal Refresh Shown", "reason"],
  ["Goal Refresh Accepted", "reason"],
  ["Goal Refresh Kept", "reason"],
];
export const STEP_KEY = "onboarding_step_completed|step_name";
/** Same screens, as [people, sum of the position each met it at]: the order of the screens. */
export const STEP_RANK_KEY = `${STEP_KEY}|rank`;
const SOURCE_KEY = "onboarding_referral_source_selected|source";
const TRIAL_SOURCE_KEY = "trial_started|referral_source";
const TRIAL_PAYWALL_KEY = "trial_started|paywall_source";
const TRIAL_PLAN_KEY = "trial_started|plan_type";
const PAYWALL_SOURCE_KEY = "paywall_viewed|source";

/**
 * "Came back" is checked at these waits: any by-hand event from `from` to
 * `to` days after the day someone signed up or started a trial.
 */
export const WAITS = [
  { from: 1, to: 1, label: "the next day" },
  { from: 7, to: 13, label: "a week later" },
  { from: 14, to: 20, label: "2 weeks later" },
  { from: 28, to: 34, label: "4 weeks later" },
  { from: 56, to: 62, label: "8 weeks later" },
];
/** A trial's first week is the day it started and the 6 after. */
const TRIAL_WEEK_LAST = 6;

type Num = number | null;

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: Num): Num => (v == null ? null : Math.round(v * 100) / 100);

/** Mean of the last `n` values ending at each position; null until at least half of them exist. */
export function rollingMean(values: Num[], n = RECENT_DAYS): Num[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - n + 1), i + 1).filter((v): v is number => v != null);
    return slice.length >= Math.ceil(n / 2) ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

/** Sum over sum for positions `a` to `b` (inclusive), times `scale`; null when the bottom is empty. */
function rateOver(num: Num[], den: Num[], a: number, b: number, scale: number): number | null {
  let top = 0;
  let bottom = 0;
  for (let k = Math.max(0, a); k <= Math.min(num.length - 1, b); k++) {
    if (num[k] == null || den[k] == null) continue;
    top += num[k] as number;
    bottom += den[k] as number;
  }
  return bottom > 0 ? (top / bottom) * scale : null;
}

/**
 * A rate over the last `n` days ending at each position, as sum over sum (so a
 * quiet day can't swing it), in percent. Null when the denominator is empty.
 */
export function rollingRate(num: Num[], den: Num[], n = RECENT_DAYS, scale = 100): Num[] {
  return num.map((_, i) => rateOver(num, den, i - n + 1, i, scale));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The last 7 days' mean, the mean of the 28 days before them, and the change between the two in percent. */
export function recentVsBase(values: Num[]): { recent: number | null; base: number | null; pct: number | null } {
  const known = (xs: Num[]) => xs.filter((v): v is number => v != null);
  const recent = mean(known(values.slice(-RECENT_DAYS)));
  const baseValues = known(values.slice(-(RECENT_DAYS + BASE_DAYS), -RECENT_DAYS));
  const base = baseValues.length >= BASE_DAYS / 2 ? mean(baseValues) : null;
  const pct = recent != null && base != null && base > 0 ? ((recent - base) / base) * 100 : null;
  return { recent, base, pct };
}

/** "+4% against the 4 weeks before", or a plain statement when there is nothing to compare. */
export function changeNote(pct: number | null): string {
  if (pct == null) return "not enough history to compare";
  const rounded = Math.round(pct);
  if (rounded === 0) return "level with the 4 weeks before";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}% against the 4 weeks before`;
}

/** The same change, short enough for a table cell: "+5%", "−25%" or "level". */
export function changeShort(pct: number | null): string {
  if (pct == null) return "";
  const rounded = Math.round(pct);
  if (rounded === 0) return "level";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}%`;
}

/** A change between two rates, in points: "+1.5 points against the 4 weeks before". */
export function pointsNote(diff: number | null): string {
  if (diff == null) return "not enough history to compare";
  const rounded = round1(diff);
  if (rounded === 0) return "level with the 4 weeks before";
  return `${rounded > 0 ? "+" : "−"}${formatNumber(Math.abs(rounded))} ${Math.abs(rounded) === 1 ? "point" : "points"} against the 4 weeks before`;
}

/** A daily count for a headline: whole numbers once it is big enough for decimals not to matter. */
export function countLabel(v: number | null): string {
  if (v == null) return "–";
  return formatNumber(v >= 20 ? Math.round(v) : round1(v));
}

export const rateLabel = (v: number | null) => (v == null ? "–" : `${formatNumber(round1(v))}%`);

export interface EventHealth {
  status: string;
  tone: Tone;
  yesterday: number;
  usual: number | null;
  /** Last 7 days' mean over the mean of the 28 days before, or null without a baseline. */
  ratio: number | null;
}

/**
 * Is an event still arriving? `totals` is one count per day, oldest first,
 * ending yesterday (0 for a day with none). Judged on the last week against
 * the four weeks before it, so one odd day does not raise a flag.
 */
export function eventHealth(totals: number[]): EventHealth {
  const yesterday = totals[totals.length - 1] ?? 0;
  const recent = totals.slice(-RECENT_DAYS);
  const baseDays = totals.slice(-(RECENT_DAYS + BASE_DAYS), -RECENT_DAYS);
  const recentMean = mean(recent) ?? 0;
  const baseMean = baseDays.length >= BASE_DAYS / 2 ? (mean(baseDays) ?? 0) : null;
  const usual = baseDays.length >= BASE_DAYS / 2 ? median(baseDays) : null;
  const out = (status: string, tone: Tone, ratio: number | null): EventHealth => ({ status, tone, yesterday, usual, ratio });

  if (baseMean == null) return out("Too little history", "neutral", null);
  if (baseMean === 0) return recentMean > 0 ? out("New", "info", null) : out("Silent", "neutral", null);
  const ratio = recentMean / baseMean;
  if (baseMean < 5) return out("Too small to judge", "neutral", ratio);
  if (totals.slice(-3).every((v) => v === 0)) return out("Stopped", "bad", ratio);
  if (ratio <= 0.5) return out("Down by half or more", "bad", ratio);
  if (ratio <= 0.75) return out("Down", "warn", ratio);
  if (ratio >= 2) return out("Doubled or more", "warn", ratio);
  return out("Steady", "good", ratio);
}

const TONE_ORDER: Record<Tone, number> = { bad: 0, warn: 1, info: 2, good: 3, neutral: 4 };

/**
 * Events the app no longer sends (removed 2026-08-04 to cut volume). Old app
 * versions still send a trickle that fades for months, which would otherwise
 * sit in the table as a permanent "Down".
 */
export const RETIRED_EVENTS = ["app_opened", "dashboard_expanded", "health_sync_completed"];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Each weekday's average as a percent of the average day (100 = an ordinary
 * day), Monday first. Null without four weeks of days or with a weekday missing.
 */
export function weekdayIndex(days: string[], values: Num[]): number[] | null {
  const sums = new Array<number>(7).fill(0);
  const counts = new Array<number>(7).fill(0);
  days.forEach((d, i) => {
    const v = values[i];
    if (v == null) return;
    const weekday = (new Date(utc(d)).getUTCDay() + 6) % 7;
    sums[weekday] += v;
    counts[weekday]++;
  });
  const known = counts.reduce((a, b) => a + b, 0);
  if (known < 28 || counts.some((c) => c === 0)) return null;
  // The mean of the seven weekday means, so a week cut short can't tilt it.
  const overall = sums.reduce((a, s, i) => a + s / counts[i], 0) / 7;
  if (overall <= 0) return null;
  return sums.map((s, i) => Math.round((s / counts[i] / overall) * 100));
}

/** From a trial cohort's histogram: active days added up, people on 4 or more days, people on day one only. */
export function activeDayCounts(h: number[] | undefined): { days: number; fourPlus: number; firstOnly: number } {
  let days = 0;
  let fourPlus = 0;
  for (let k = 1; k < (h?.length ?? 0); k++) {
    days += k * (h?.[k] ?? 0);
    if (k >= 4) fourPlus += h?.[k] ?? 0;
  }
  return { days, fourPlus, firstOnly: h?.[1] ?? 0 };
}

/** "save_progress" -> "Save progress". */
const pretty = (raw: string) => {
  const words = raw.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : raw;
};

const SOURCE_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  app_store: "App Store",
  friend_family: "A friend or family",
  google: "Google",
  youtube: "YouTube",
  other: "Other",
};
const sourceLabel = (v: string) => SOURCE_LABELS[v] ?? pretty(v);

const PAYWALL_LABELS: Record<string, string> = {
  onboarding: "the main paywall",
  exploding_offer: "the exploding offer",
  mini_paywall: "a locked-feature paywall",
  return_offer: "a return offer",
};
const paywallLabel = (v: string) => PAYWALL_LABELS[v] ?? pretty(v);

const REASON_LABELS: Record<string, string> = {
  legacy_formula: "Goals set by the old formula (`legacy_formula`)",
  weight_drift: "Weight has moved since the goals were set (`weight_drift`)",
};

// ---- Reading the rows ----------------------------------------------------

const USERS = 0;
const TOTAL = 1;
const IOS_USERS = 2;
const ANDROID_USERS = 4;

interface Pick {
  label: string;
  event: string;
  /** users (default) or total events */
  field?: typeof USERS | typeof TOTAL;
}

const FEATURES: Pick[] = [
  { label: "Logged a meal", event: "meal_logged" },
  { label: "Scanned food with a photo", event: "food_scan_completed" },
  { label: "Scanned a barcode", event: "barcode_scan_completed" },
  { label: "Logged a shot", event: "shot_logged" },
  { label: "Logged a weight", event: "weight_logged" },
  { label: "Logged a side effect", event: "side_effect_logged" },
  { label: "Logged water or protein", event: "stat_logged" },
  { label: "Sent an AI chat message", event: "ai_chat_message_sent" },
  { label: "Claimed a mission", event: "mission_claimed" },
  { label: "Dressed the fish", event: "item_equipped" },
  { label: "Opened a lootbox", event: "lootbox_opened" },
  { label: "Opened a community post", event: "community_post_opened" },
];

const WEEKDAY_PICKS: Pick[] = [
  { label: "Logged a shot", event: "shot_logged" },
  { label: "Logged a weight", event: "weight_logged" },
  { label: "Logged a meal", event: "meal_logged" },
];

const SUBSCRIPTIONS: Pick[] = [
  { label: "Trials started", event: "rc_trial_started_event" },
  { label: "Trials cancelled", event: "rc_trial_cancelled_event" },
  { label: "Trials that became paid", event: "rc_trial_converted_event" },
  { label: "Renewals", event: "rc_renewal_event" },
  { label: "Paid subscriptions cancelled", event: "rc_cancellation_event" },
  { label: "Subscriptions that ended", event: "rc_expiration_event" },
];

const SCREENS: Pick[] = [
  { label: "Saw the paywall", event: "paywall_viewed" },
  { label: "Hit a free-mode limit", event: "free_gate_hit" },
  { label: "Opened subscription settings", event: "subscription_management_opened" },
  { label: "Were shown a return offer", event: "return_offer_shown" },
  { label: "Accepted a return offer", event: "return_offer_accepted" },
];

const HEALTH: Pick[] = [
  { label: "People with a failed sync", event: "health_sync_failed" },
  { label: "People who tapped repair", event: "health_sync_repair_tapped" },
];

/** The stored days, laid out for the charts: one position per day, gaps kept as gaps. */
interface Ctx {
  through: string;
  /** Every day the comparisons can look back over, oldest first, ending at `through`. */
  days: string[];
  /** How many of the last days a daily chart shows, and those days. */
  shown: number;
  shownDays: string[];
  /** The same for the cohort charts, which need a longer run. */
  longShown: number;
  longDays: string[];
  row(day: string): DailyRow | undefined;
  /** One value per day; null where the whole day is missing, 0 where only the value is. */
  column(fn: (r: DailyRow) => number | undefined): Num[];
  event(event: string, field?: number): Num[];
  /** One value of a property per day; null on a day whose breakdowns were never pulled. */
  breakdown(key: string, value: string, field?: number): Num[];
  /** Every value of a property added up. */
  breakdownAll(key: string, field?: number): Num[];
  /** The values seen in the last `lastDays` days, most people first. */
  values(key: string, lastDays: number): { value: string; users: number }[];
  /** A cohort figure by the day the cohort began; null until `waitTo` days have fully passed. */
  cohort(kind: "signup" | "trial", pick: (c: CohortCounts) => number, waitTo: number): Num[];
}

function makeContext(complete: DailyRow[], windowDays: number): Ctx {
  const through = complete[complete.length - 1].day;
  const first = complete[0].day;
  const span = Math.max(windowDays, LONG_WINDOW_DAYS);
  const wantedStart = addDays(through, -(span + RECENT_DAYS + BASE_DAYS - 1));
  const start = first > wantedStart ? first : wantedStart;

  const byDay = new Map(complete.map((r) => [r.day, r]));
  const days: string[] = [];
  for (let d = start; d <= through; d = addDays(d, 1)) days.push(d);
  const shown = Math.min(windowDays, days.length);
  const longShown = Math.min(span, days.length);

  const column: Ctx["column"] = (fn) =>
    days.map((d) => {
      const r = byDay.get(d);
      return r ? (fn(r) ?? 0) : null;
    });
  const pulled = (r: DailyRow | undefined): r is DailyRow & { breakdowns: Breakdowns } =>
    !!r?.breakdowns && Object.keys(r.breakdowns).length > 0;
  const perDay = (fn: (b: Breakdowns) => number): Num[] =>
    days.map((d) => {
      const r = byDay.get(d);
      return pulled(r) ? fn(r.breakdowns) : null;
    });

  return {
    through,
    days,
    shown,
    shownDays: days.slice(-shown),
    longShown,
    longDays: days.slice(-longShown),
    row: (d) => byDay.get(d),
    column,
    event: (event, field = USERS) => column((r) => r.events[event]?.[field]),
    breakdown: (key, value, field = USERS) => perDay((b) => b[key]?.[value]?.[field] ?? 0),
    breakdownAll: (key, field = USERS) =>
      perDay((b) => Object.values(b[key] ?? {}).reduce((a, counts) => a + (counts[field] ?? 0), 0)),
    values: (key, lastDays) => {
      const totals = new Map<string, number>();
      for (const d of days.slice(-lastDays)) {
        for (const [value, counts] of Object.entries(byDay.get(d)?.breakdowns?.[key] ?? {})) {
          totals.set(value, (totals.get(value) ?? 0) + (counts[USERS] ?? 0));
        }
      }
      return [...totals.entries()]
        .map(([value, users]) => ({ value, users }))
        .sort((a, b) => b.users - a.users || a.value.localeCompare(b.value));
    },
    cohort: (kind, pick, waitTo) =>
      days.map((d) => {
        const cohorts = byDay.get(d)?.cohorts;
        const counts = cohorts?.[kind];
        if (!counts || !cohorts?.through || addDays(d, waitTo) > cohorts.through) return null;
        return pick(counts);
      }),
  };
}

const add = (a: Num[], b: Num[]): Num[] => a.map((v, i) => (v == null || b[i] == null ? null : v + (b[i] as number)));
const sumOf = (values: Num[]) => values.reduce<number>((a, v) => a + (v ?? 0), 0);
const lastKnown = (values: Num[]) => {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] != null) return i;
  return -1;
};

function countSeries(c: Ctx, label: string, values: Num[]): DailySeries {
  const smooth = rollingMean(values);
  const { recent, pct } = recentVsBase(values);
  return {
    label,
    values: values.slice(-c.shown),
    smooth: smooth.slice(-c.shown).map(round2),
    headline: countLabel(recent),
    note: `a day, 7-day average, ${changeNote(pct)}`,
  };
}

interface RateOptions {
  /** "share" is a percent of the bottom number (default); "each" is a plain ratio, such as views per person. */
  kind?: "share" | "each";
  /** Draw the cohort charts' longer run of days. */
  long?: boolean;
}

interface RateFigure {
  /** The newest 7 measurable days, formatted. */
  headline: string;
  /** How that compares with the 28 days before. */
  versus: string;
  series: DailySeries;
}

/**
 * A rate by day: each day's own figure as the thin line, the trailing 7 days
 * (sum over sum) as the thick one. The headline is the newest 7 days that can
 * be measured, which for a cohort chart is not the last 7 on the calendar.
 */
function rateFigure(c: Ctx, label: string, num: Num[], den: Num[], o: RateOptions = {}): RateFigure {
  const each = o.kind === "each";
  const scale = each ? 1 : 100;
  const shown = o.long ? c.longShown : c.shown;
  const daily = num.map((n, i) => (n != null && den[i] != null && (den[i] as number) > 0 ? (n / (den[i] as number)) * scale : null));
  const last = lastKnown(daily);
  const smooth = rollingRate(num, den, RECENT_DAYS, scale).map((v, i) => (i > last ? null : v));
  const latest = last >= 0 ? rateOver(num, den, last - RECENT_DAYS + 1, last, scale) : null;
  const base = last >= 0 ? rateOver(num, den, last - RECENT_DAYS - BASE_DAYS + 1, last - RECENT_DAYS, scale) : null;
  const versus =
    latest == null || base == null
      ? "not enough history to compare"
      : each
        ? changeNote(base > 0 ? ((latest - base) / base) * 100 : null)
        : pointsNote(latest - base);
  const headline = each ? (latest == null ? "–" : round1(latest).toFixed(1)) : rateLabel(latest);
  const window = o.long ? "newest 7 measurable days" : "over the last 7 days";
  return {
    headline,
    versus,
    series: {
      label,
      values: daily.slice(-shown).map(round2),
      smooth: smooth.slice(-shown).map(round2),
      headline,
      note: `${window}, ${versus}`,
      ...(each ? {} : { unit: "%" }),
    },
  };
}

const rateSeries = (c: Ctx, label: string, num: Num[], den: Num[], o?: RateOptions) => rateFigure(c, label, num, den, o).series;

const anyIn = (values: Num[], shown: number) => values.slice(-shown).some((v) => v != null && v > 0);

function pickSeries(c: Ctx, picks: Pick[]): DailySeries[] {
  return picks
    .map((p) => ({ p, values: c.event(p.event, p.field) }))
    .filter((x) => anyIn(x.values, c.shown))
    .map((x) => countSeries(c, x.p.label, x.values));
}

function seriesBlock(days: string[], title: string, series: DailySeries[], caption?: string, half?: boolean): Block | null {
  return series.length && days.length >= 2 ? { type: "series", title, caption, half, days, series } : null;
}

const blocks = (...bs: (Block | null)[]) => bs.filter((b): b is Block => b != null);
const kept = (sections: Section[]) => sections.filter((s) => s.blocks.length > 0);

// ---- Daily ---------------------------------------------------------------

function dailySections(c: Ctx): { sections: Section[]; attention: number } {
  const act = c.column((r) => r.people.act?.[0]);
  const seen = c.column((r) => r.people.seen?.[0]);
  const sessions = c.event("app_session_started");
  const people: DailySeries[] = [
    countSeries(c, "Did something by hand", act),
    countSeries(c, "Had a screen up", seen),
    ...(anyIn(sessions, c.shown) ? [countSeries(c, "Started a session", sessions)] : []),
  ];
  const phones: DailySeries[] = [
    countSeries(c, "iPhone, did something by hand", c.column((r) => r.people.act?.[1])),
    countSeries(c, "Android, did something by hand", c.column((r) => r.people.act?.[2])),
  ];

  // Features: people, their share of everyone active, and how often each person does it.
  const featureColumns = FEATURES.map((p) => ({ p, users: c.event(p.event), total: c.event(p.event, TOTAL) })).filter((x) =>
    anyIn(x.users, c.shown),
  );
  const perPersonRows: TableCell[][] = featureColumns.map(({ p, users, total }) => {
    const n = users.length;
    const now = rateOver(total, users, n - RECENT_DAYS, n - 1, 1);
    const before = rateOver(total, users, n - RECENT_DAYS - BASE_DAYS, n - RECENT_DAYS - 1, 1);
    const people7 = recentVsBase(users).recent;
    return [
      p.label,
      people7 == null ? null : Math.round(people7),
      now == null ? null : round1(now),
      now != null && before != null && before > 0 ? changeShort(((now - before) / before) * 100) : "",
    ];
  });

  // Which days of the week: the last 8 weeks, each feature against its own average day.
  const lastWeeks = c.days.slice(-56);
  const weekdaySeries: Series[] = [...WEEKDAY_PICKS.map((p) => ({ label: p.label, values: c.event(p.event) })), { label: "Did something by hand", values: act }]
    .map((x) => ({ label: x.label, values: weekdayIndex(lastWeeks, x.values.slice(-lastWeeks.length)) }))
    .filter((x): x is Series => x.values != null);

  // Prompts: how often each one comes up against how often it is acted on.
  const refreshPeople = c.event("Goal Refresh Shown");
  const refreshAnswered = add(c.event("Goal Refresh Accepted"), c.event("Goal Refresh Kept"));
  const offerShown = c.event("return_offer_shown");
  const tourStarted = c.event("guided_flow_started");
  const prompts: DailySeries[] = [
    ...(anyIn(refreshPeople, c.shown)
      ? [
          countSeries(c, "Goal refresh: people it fired for", refreshPeople),
          rateSeries(c, "Goal refresh: times fired per person", c.event("Goal Refresh Shown", TOTAL), refreshPeople, { kind: "each" }),
          rateSeries(c, "Goal refresh: answered, of people it fired for", refreshAnswered, refreshPeople),
        ]
      : []),
    ...(anyIn(offerShown, c.shown) ? [rateSeries(c, "Return offer: accepted, of people shown it", c.event("return_offer_accepted"), offerShown)] : []),
    ...(anyIn(tourStarted, c.shown)
      ? [rateSeries(c, "Guided tours: dismissed, of people who started one", c.event("guided_flow_dismissed"), tourStarted)]
      : []),
  ];
  const reasonRows: TableCell[][] = c.values("Goal Refresh Shown|reason", RECENT_DAYS).map(({ value }) => {
    const week = (key: string, field: number) => sumOf(c.breakdown(key, value, field).slice(-RECENT_DAYS));
    return [
      REASON_LABELS[value] ?? `\`${value}\``,
      week("Goal Refresh Shown|reason", TOTAL),
      week("Goal Refresh Accepted|reason", TOTAL),
      week("Goal Refresh Kept|reason", TOTAL),
    ];
  });

  const sent = c.event("notification_sent", TOTAL);
  const opened = c.event("notification_opened", TOTAL);

  // Is every event still arriving
  const names = new Set<string>();
  const lookback = c.days.slice(-(RECENT_DAYS + BASE_DAYS));
  for (const d of lookback) for (const n of Object.keys(c.row(d)?.events ?? {})) names.add(n);
  const health = [...names].map((name) => {
    const totals = lookback.map((d) => c.row(d)?.events[name]?.[TOTAL] ?? 0);
    const judged = eventHealth(totals);
    return RETIRED_EVENTS.includes(name)
      ? { name, ...judged, status: "Removed from the app", tone: "neutral" as Tone }
      : { name, ...judged };
  });
  health.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || (b.usual ?? 0) - (a.usual ?? 0) || a.name.localeCompare(b.name));
  const flagged = health.filter((h) => h.tone === "bad" || h.tone === "warn");
  const healthRows: TableCell[][] = health.map((h) => [
    `\`${h.name}\``,
    h.yesterday,
    h.usual == null ? null : Math.round(h.usual),
    h.ratio == null ? "" : changeShort((h.ratio - 1) * 100),
    { status: h.status, tone: h.tone },
  ]);

  const actNow = recentVsBase(act);
  const mealsNow = recentVsBase(c.event("meal_logged"));
  const trialsNow = recentVsBase(c.event("trial_started"));

  const sections: Section[] = [
    {
      id: "now",
      title: "The last 7 days",
      blocks: [
        {
          type: "stats",
          items: [
            { label: "People who did something in the app, a day", value: countLabel(actNow.recent), note: changeNote(actNow.pct) },
            { label: "People who logged a meal, a day", value: countLabel(mealsNow.recent), note: changeNote(mealsNow.pct) },
            { label: "People who started a trial, a day", value: countLabel(trialsNow.recent), note: changeNote(trialsNow.pct) },
            {
              label: "Events that stopped, dropped or doubled",
              value: String(flagged.length),
              note: flagged.length
                ? flagged
                    .slice(0, 2)
                    .map((f) => f.name)
                    .join(", ") + (flagged.length > 2 ? ` and ${flagged.length - 2} more` : "")
                : "Every event is arriving as usual",
            },
          ],
        },
      ],
    },
    {
      id: "people",
      title: "People in the app",
      intro:
        "By hand means a tap or a log. A screen up adds people who only saw something, such as the paywall. Someone who opens the app and sees nothing tracked is in neither, so both are floors. A session count takes over once the new app-open event ships.",
      blocks: blocks(seriesBlock(c.shownDays, "People a day", people, undefined, true), seriesBlock(c.shownDays, "By phone", phones, undefined, true)),
    },
    {
      id: "features",
      title: "What they do",
      intro:
        "People doing each thing a day. Two of these run low: `meal_logged` misses some meal-logging days (see Tracking), and `stat_logged` has missed over half of water and protein logging since the August 2026 release, going by the database.",
      blocks: blocks(
        seriesBlock(c.shownDays, "People a day, by feature", pickSeries(c, FEATURES)),
        seriesBlock(
          c.shownDays,
          "Share of active people, by feature",
          featureColumns.map(({ p, users }) => rateSeries(c, p.label, users, act)),
          "Each feature's people as a share of everyone who did something by hand that day. A count can fall because fewer people came; a share only falls when the feature lost ground.",
        ),
        perPersonRows.length
          ? {
              type: "table",
              title: "How often, per person",
              caption: "The last 7 days: times the thing was done, over the people who did it that day.",
              columns: [
                { label: "Feature" },
                { label: "People a day", kind: "num" },
                { label: "Times per person a day", kind: "num" },
                { label: "Times per person, against the 4 weeks before" },
              ],
              rows: perPersonRows,
            }
          : null,
      ),
    },
    {
      id: "weekdays",
      title: "Which days of the week",
      blocks: blocks(
        weekdaySeries.length
          ? {
              type: "columns",
              caption:
                "Each weekday against that thing's own average day over the last 8 weeks, in Eastern time, where 100 is an average day. All four charts share one scale.",
              x: WEEKDAYS,
              series: weekdaySeries,
            }
          : null,
      ),
    },
    {
      id: "prompts",
      title: "Prompts, shown against acted on",
      intro:
        "`Goal Refresh Shown` fires once per app session until the person answers, including when the paywall is covering the sheet, so it counts sessions with the prompt pending and overstates what people saw.",
      blocks: blocks(
        seriesBlock(c.shownDays, "A day", prompts),
        reasonRows.length
          ? {
              type: "table",
              title: "Goal refresh by reason, last 7 days",
              columns: [
                { label: "Why it came up" },
                { label: "Times fired", kind: "num" },
                { label: "Accepted the new goals", kind: "num" },
                { label: "Kept the old goals", kind: "num" },
              ],
              rows: reasonRows,
            }
          : null,
      ),
    },
    {
      id: "push",
      title: "Push notifications",
      blocks: blocks(
        anyIn(sent, c.shown)
          ? seriesBlock(c.shownDays, "Sends and taps a day", [
              countSeries(c, "Notifications sent", sent),
              countSeries(c, "Notifications tapped", opened),
              rateSeries(c, "Share of sends tapped", opened, sent),
            ])
          : null,
      ),
    },
    {
      id: "health",
      title: "Health sync",
      intro: "A failed sync does not mean the data is missing: most people with a failure still get their steps that day (see Next).",
      blocks: blocks(seriesBlock(c.shownDays, "People a day", pickSeries(c, HEALTH))),
    },
    {
      id: "arriving",
      title: "Is every event still arriving",
      intro: "Each event's last 7 days against the 4 weeks before. An event that stops or halves is flagged here the next morning.",
      blocks: [
        {
          type: "table",
          columns: [
            { label: "Event" },
            { label: "Yesterday", kind: "num" },
            { label: "Usual day", kind: "num" },
            { label: "Last 7 days against usual" },
            { label: "Status", kind: "status" },
          ],
          rows: healthRows,
          // Anything flagged sorts to the top, so the first rows always include it.
          limit: Math.max(12, flagged.length + 6),
        },
      ],
    },
  ];
  return { sections: kept(sections), attention: flagged.length };
}

// ---- New people ----------------------------------------------------------

/** Onboarding screens in the order people meet them, with how far the last 7 days' starters got. */
function screenRows(c: Ctx): TableCell[][] {
  const withSteps = (days: string[]) => days.filter((d) => c.row(d)?.breakdowns?.[STEP_KEY]);
  const recent = withSteps(c.days.slice(-RECENT_DAYS));
  const base = withSteps(c.days.slice(-(RECENT_DAYS + BASE_DAYS), -RECENT_DAYS));
  const people = (days: string[], step: string) => days.reduce((a, d) => a + (c.row(d)?.breakdowns?.[STEP_KEY]?.[step]?.[USERS] ?? 0), 0);
  const eventPeople = (days: string[], event: string) => days.reduce((a, d) => a + (c.row(d)?.events[event]?.[USERS] ?? 0), 0);

  const starters = eventPeople(recent, "onboarding_started");
  if (!recent.length || starters <= 0) return [];
  const baseStarters = base.length >= BASE_DAYS / 2 ? eventPeople(base, "onboarding_started") : 0;

  const position = new Map<string, [number, number]>();
  for (const d of [...base, ...recent]) {
    for (const [step, [users, sum]] of Object.entries(c.row(d)?.breakdowns?.[STEP_RANK_KEY] ?? {})) {
      const at = position.get(step) ?? [0, 0];
      position.set(step, [at[0] + users, at[1] + sum]);
    }
  }
  const order = (step: string) => {
    const at = position.get(step);
    return at && at[0] > 0 ? at[1] / at[0] : Number.MAX_SAFE_INTEGER;
  };
  const reach = (days: string[], count: number, of: number) => (days.length && of > 0 ? (count / of) * 100 : null);

  const steps = c
    .values(STEP_KEY, RECENT_DAYS)
    .map((v) => v.value)
    // A screen only old app versions still send reaches almost nobody; it would clutter the list.
    .filter((step) => people(recent, step) / starters >= 0.05)
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((step) => ({ label: pretty(step), count: people(recent, step), was: reach(base, people(base, step), baseStarters) }));
  if (!steps.length) return [];
  steps.push({
    label: "Started a trial (after the paywall)",
    count: eventPeople(recent, "trial_started"),
    was: reach(base, eventPeople(base, "trial_started"), baseStarters),
  });

  const now = steps.map((s) => (s.count / starters) * 100);
  let before: number | null = null;
  return steps.map((s, i) => {
    // More people on a later screen means this one is skipped for some: don't read it as a loss.
    const skippedBySome = now.slice(i + 1).some((later) => later > now[i] + 2);
    const change = skippedBySome || before == null ? null : round1(now[i] - before);
    if (!skippedBySome) before = now[i];
    return [
      skippedBySome ? `${s.label} (not shown to everyone)` : s.label,
      s.count,
      round1(now[i]),
      change,
      s.was == null ? null : round1(now[i] - s.was),
    ];
  });
}

function newPeopleSections(c: Ctx): Section[] {
  const onboarding = c.event("onboarding_started");
  const signUps = c.event("sign_up_completed");
  const trials = c.event("trial_started");
  const sum7 = (values: Num[]) => sumOf(values.slice(-RECENT_DAYS));

  const byPhone = (event: string): DailySeries[] => [
    rateSeries(c, "iPhone", c.event(event, IOS_USERS), c.event("onboarding_started", IOS_USERS)),
    rateSeries(c, "Android", c.event(event, ANDROID_USERS), c.event("onboarding_started", ANDROID_USERS)),
  ];
  const hasAndroid = anyIn(c.event("onboarding_started", ANDROID_USERS), c.shown);

  // Where they say they came from
  const answers = c.breakdownAll(SOURCE_KEY);
  const sourceTotals = c.values(SOURCE_KEY, RECENT_DAYS + BASE_DAYS);
  const allAnswers = sourceTotals.reduce((a, s) => a + s.users, 0);
  const sources = sourceTotals.filter((s) => allAnswers > 0 && s.users / allAnswers >= 0.02).slice(0, 7);
  const isSource = (v: string) => sources.some((s) => s.value === v);
  const sourceSeries: DailySeries[] = anyIn(answers, c.shown)
    ? [
        ...(isSource("facebook") && isSource("instagram")
          ? [rateSeries(c, "Facebook or Instagram", add(c.breakdown(SOURCE_KEY, "facebook"), c.breakdown(SOURCE_KEY, "instagram")), answers)]
          : []),
        ...sources.map((s) => rateSeries(c, sourceLabel(s.value), c.breakdown(SOURCE_KEY, s.value), answers)),
      ]
    : [];
  const month = c.days.slice(-BASE_DAYS).filter((d) => c.row(d)?.breakdowns?.[SOURCE_KEY]);
  const monthSum = (key: string, value: string) => month.reduce((a, d) => a + (c.row(d)?.breakdowns?.[key]?.[value]?.[USERS] ?? 0), 0);
  const monthAnswers = sources.reduce((a, s) => a + monthSum(SOURCE_KEY, s.value), 0);
  const perDay = (v: number) => (v / month.length >= 20 ? Math.round(v / month.length) : round1(v / month.length));
  const sourceRows: TableCell[][] =
    month.length && monthAnswers > 0
      ? sources
          .map((s) => ({ s, said: monthSum(SOURCE_KEY, s.value), started: monthSum(TRIAL_SOURCE_KEY, s.value) }))
          .filter((x) => x.said > 0)
          .map(({ s, said, started }) => [
            sourceLabel(s.value),
            perDay(said),
            round1((said / monthAnswers) * 100),
            perDay(started),
            round1((started / said) * 100),
          ])
      : [];

  // Paywall pressure, and which paywall the trials came from
  const paywallViews = c.event("paywall_viewed", TOTAL);
  const paywallPeople = c.event("paywall_viewed");
  const plans = c.breakdownAll(TRIAL_PLAN_KEY);
  const paywallTotals = c.values(TRIAL_PAYWALL_KEY, RECENT_DAYS + BASE_DAYS);
  const paywallTrials = paywallTotals.reduce((a, v) => a + v.users, 0);
  // A paywall behind a handful of trials a month would be a chart of noise.
  const trialPaywalls = paywallTotals.filter((v) => v.users / paywallTrials >= 0.03).slice(0, 4);
  const pressure: DailySeries[] = [
    ...(anyIn(paywallPeople, c.shown)
      ? [
          rateSeries(c, "Paywall views per person who saw it", paywallViews, paywallPeople, { kind: "each" }),
          rateSeries(c, "Started a trial, of people who saw the paywall", trials, paywallPeople),
          ...c
            .values(PAYWALL_SOURCE_KEY, RECENT_DAYS + BASE_DAYS)
            .slice(0, 3)
            .map((v) => countSeries(c, `People who saw ${paywallLabel(v.value)}`, c.breakdown(PAYWALL_SOURCE_KEY, v.value))),
        ]
      : []),
    ...trialPaywalls.map((v) => countSeries(c, `Trials started from ${paywallLabel(v.value)}`, c.breakdown(TRIAL_PAYWALL_KEY, v.value))),
    ...(anyIn(plans, c.shown) ? [rateSeries(c, "Share of trials on the yearly plan", c.breakdown(TRIAL_PLAN_KEY, "yearly"), plans)] : []),
  ];

  const screens = screenRows(c);

  return kept([
    {
      id: "start",
      title: "Start to trial",
      blocks: blocks(
        sum7(onboarding) > 0
          ? {
              type: "bars",
              title: "The last 7 days",
              caption: "Each day's people added up, so someone whose onboarding spans midnight counts twice.",
              rows: [
                { label: "Started onboarding", value: sum7(onboarding) },
                { label: "Signed up", value: sum7(signUps) },
                { label: "Started a trial", value: sum7(trials) },
              ],
            }
          : null,
        seriesBlock(c.shownDays, "New people a day", [
          countSeries(c, "Started onboarding", onboarding),
          countSeries(c, "Signed up", signUps),
          countSeries(c, "Started a trial", trials),
          rateSeries(c, "Sign-ups per onboarding start", signUps, onboarding),
          rateSeries(c, "Trial starts per onboarding start", trials, onboarding),
        ]),
      ),
    },
    {
      id: "phones",
      title: "iPhone against Android",
      intro: "The same two rates for each phone, so a gap between them is a gap in the app, not in who was reached.",
      blocks: blocks(
        hasAndroid ? seriesBlock(c.shownDays, "Sign-ups per onboarding start", byPhone("sign_up_completed"), undefined, true) : null,
        hasAndroid ? seriesBlock(c.shownDays, "Trial starts per onboarding start", byPhone("trial_started"), undefined, true) : null,
      ),
    },
    {
      id: "screens",
      title: "Where onboarding loses people",
      intro:
        "Every onboarding screen in the order people meet it, with the share of starters who finished it. The trial row at the end is the paywall's result.",
      blocks: blocks(
        screens.length
          ? {
              type: "table",
              caption: "The last 7 days, each day's people added up. Changes are in points of everyone who started.",
              columns: [
                { label: "Screen" },
                { label: "People who finished it", kind: "num" },
                { label: "Of those who started", kind: "bar", unit: "%", max: 100 },
                { label: "Change from the screen before", kind: "num", unit: "pts" },
                { label: "Against the 4 weeks before", kind: "num", unit: "pts" },
              ],
              rows: screens,
            }
          : null,
      ),
    },
    {
      id: "source",
      title: "Where they say they came from",
      intro:
        "The answer picked on the onboarding screen that asks how they heard about the app. It is what people remember, not a tracked click, which is what makes it a check on what the ad platforms claim.",
      blocks: blocks(
        seriesBlock(c.shownDays, "Share of answers", sourceSeries),
        sourceRows.length
          ? {
              type: "table",
              title: "By answer, last 28 days",
              caption:
                "A trial counts under the answer its person gave, on the day the trial started, so the last column is trials over answers in the same days, not the same people followed through.",
              columns: [
                { label: "Answer" },
                { label: "Answers a day", kind: "num" },
                { label: "Share of answers", kind: "bar", unit: "%" },
                { label: "Trial starts a day", kind: "num" },
                { label: "Trial starts per 100 answers", kind: "num" },
              ],
              rows: sourceRows,
            }
          : null,
      ),
    },
    {
      id: "paywall",
      title: "Paywall and subscription screens",
      intro: "Opening subscription settings early in a trial went with a much lower paid rate (see Stay), so that chart is an early read on cancels.",
      blocks: blocks(
        seriesBlock(c.shownDays, "People a day", pickSeries(c, SCREENS)),
        seriesBlock(
          c.shownDays,
          "Paywall pressure, and where trials come from",
          pressure,
          "Views per person counts every time the paywall came up. A trial is counted under the paywall it was bought on.",
        ),
      ),
    },
    {
      id: "subscriptions",
      title: "Subscription events",
      blocks: blocks(
        seriesBlock(
          c.shownDays,
          "A day",
          pickSeries(c, SUBSCRIPTIONS),
          "As RevenueCat reports them to Mixpanel. The Overview's trial count is the real total; this one runs slightly under it.",
        ),
      ),
    },
  ]);
}

// ---- Coming back ---------------------------------------------------------

function comingBackSections(c: Ctx): Section[] {
  const cameBack = (kind: "signup" | "trial", label: (wait: string) => string) =>
    WAITS.map((w, i) =>
      rateFigure(
        c,
        label(w.label),
        c.cohort(kind, (x) => x.f[i] ?? 0, w.to),
        c.cohort(kind, (x) => x.n, w.to),
        { long: true },
      ),
    );
  const measured = (f: RateFigure) => f.series.values.some((v) => v != null);

  const signups = cameBack("signup", (wait) => `Came back ${wait}`);
  const trialLater = cameBack("trial", (wait) => `Came back ${wait}`);

  const trialPeople = c.cohort("trial", (x) => x.n, TRIAL_WEEK_LAST);
  const firstWeek = (pick: (h: ReturnType<typeof activeDayCounts>) => number) =>
    c.cohort("trial", (x) => pick(activeDayCounts(x.h)), TRIAL_WEEK_LAST);
  const activeDays = rateFigure(c, "Average active days in the first 7", firstWeek((h) => h.days), trialPeople, { kind: "each", long: true });
  const fourPlus = rateFigure(c, "Active on 4 or more of the 7 days", firstWeek((h) => h.fourPlus), trialPeople, { long: true });
  const firstOnly = rateFigure(c, "Active on the first day only", firstWeek((h) => h.firstOnly), trialPeople, { long: true });

  // How the first week is spread: the newest 4 weeks of trials that have had a full week, and the 4 before.
  const settled = c.days.filter((d) => {
    const cohorts = c.row(d)?.cohorts;
    return !!cohorts?.trial?.h && !!cohorts.through && addDays(d, TRIAL_WEEK_LAST) <= cohorts.through;
  });
  const spread = (days: string[]): Series | null => {
    const h = new Array<number>(8).fill(0);
    for (const d of days) (c.row(d)?.cohorts?.trial?.h ?? []).forEach((v, k) => (h[k] += v));
    const people = h.slice(1).reduce((a, b) => a + b, 0);
    if (!days.length || people <= 0) return null;
    return {
      label: `Trials started ${shortDateLabel(days[0])} to ${shortDateLabel(days[days.length - 1])}`,
      values: h.slice(1).map((v) => Math.round((v / people) * 100)),
    };
  };
  const spreads = [spread(settled.slice(-BASE_DAYS)), spread(settled.slice(-2 * BASE_DAYS, -BASE_DAYS))].filter((s): s is Series => s != null);

  const stat = (label: string, f: RateFigure): StatItem => ({ label, value: f.headline, note: f.versus });
  const stats: StatItem[] = [
    ...(measured(signups[0]) ? [stat("Sign-ups who came back the next day", signups[0])] : []),
    ...(measured(signups[1]) ? [stat("Sign-ups who came back a week later", signups[1])] : []),
    ...(measured(activeDays) ? [stat("Active days in a trial's first 7", activeDays)] : []),
    ...(measured(trialLater[3]) ? [stat("Trial starters still active 4 weeks later", trialLater[3])] : []),
  ];

  return kept([
    {
      id: "now",
      title: "The newest figures",
      blocks: blocks(stats.length ? { type: "stats", items: stats } : null),
    },
    {
      id: "signups",
      title: "Do new sign-ups come back",
      intro:
        "Everyone who created an account, by the day they did, trial or not. A week later means any day from 7 to 13 days after; the other waits are a week wide in the same way.",
      blocks: blocks(seriesBlock(c.longDays, "Of people who signed up that day", signups.filter(measured).map((f) => f.series))),
    },
    {
      id: "trial-week",
      title: "The first week of a trial",
      intro:
        "How many of a trial's first 7 days the person did something, counting the day it started. More active days went with a much higher paid rate (see Stay), so this moves about a week before the paid numbers do.",
      blocks: blocks(
        seriesBlock(
          c.longDays,
          "Of people who started a trial that day",
          [activeDays, fourPlus, firstOnly].filter(measured).map((f) => f.series),
        ),
        spreads.length
          ? {
              type: "columns",
              title: "How the first week is spread",
              caption: "Share of trial starters by how many of their first 7 days they were active. Both charts share one scale.",
              unit: "%",
              xLabel: "Active days in the first 7",
              x: ["1", "2", "3", "4", "5", "6", "7"],
              series: spreads,
            }
          : null,
      ),
    },
    {
      id: "trial-later",
      title: "Do trial starters keep using it",
      intro: "Everyone who started a trial, by the day it started, including people who cancelled it. This is use, not payment.",
      blocks: blocks(seriesBlock(c.longDays, "Of people who started a trial that day", trialLater.filter(measured).map((f) => f.series))),
    },
  ]);
}

// ---- The views -----------------------------------------------------------

export interface DailyViewResult {
  /** The Daily view; null when no complete day is stored yet. */
  view: View | null;
  /** Every live view that has something to show, Daily first. */
  views: View[];
  /** The last complete Eastern day shown. */
  through: string | null;
  /** Events flagged as stopped, down or doubled. */
  attention: number;
}

/**
 * Build the live views. `today` is the current Eastern day: it and anything
 * later is left out, because a part-day reads as a crash on a daily chart.
 */
export function buildDailyView(rows: DailyRow[], opts: { today: string; windowDays: number }): DailyViewResult {
  const complete = rows.filter((r) => r.day < opts.today).sort((a, b) => a.day.localeCompare(b.day));
  if (!complete.length) return { view: null, views: [], through: null, attention: 0 };

  const c = makeContext(complete, Math.max(7, Math.round(opts.windowDays)));
  const daily = dailySections(c);
  const view: View = {
    id: DAILY_VIEW_ID,
    label: "Daily",
    intro:
      "Mixpanel's own counts by Eastern day. The thick line is the 7-day average and the thin line is each day. Each chart prints its own scale underneath; one that does not start at zero is zoomed in to show the movement.",
    sections: daily.sections,
  };
  const newPeople: View = {
    id: NEW_PEOPLE_VIEW_ID,
    label: "New people",
    intro:
      "From the first onboarding screen to a trial. Counts are people per Eastern day; on a rate chart the thick line is the last 7 days added up and the thin line is each day on its own.",
    sections: newPeopleSections(c),
  };
  const comingBack: View = {
    id: COMING_BACK_VIEW_ID,
    label: "Coming back",
    intro:
      "Whether people return after signing up or starting a trial. Came back means a tap or a log on that day; opening the app without touching anything is not tracked yet, so every figure here is a floor. Each day's people only get a figure once their wait has fully passed, so the longer waits stop further back. These charts always show at least 90 days.",
    sections: comingBackSections(c),
  };

  return {
    view,
    views: [view, newPeople, comingBack].filter((v) => v.sections.length > 0),
    through: c.through,
    attention: daily.attention,
  };
}
