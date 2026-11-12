/**
 * App Analytics > Daily: turns stored Mixpanel days into the view the tab
 * draws (pure, safe for tests and the client bundle).
 *
 * Input is one row per Eastern day (see migration 0111). Output is an ordinary
 * App Analytics view: headline stats, small daily charts, and a table that
 * says whether every event is still arriving. That last table exists because
 * `app_opened` was removed in August and nobody noticed for three months.
 */
import {
  formatNumber,
  type Block,
  type DailySeries,
  type Section,
  type TableCell,
  type Tone,
  type View,
} from "@/lib/app-analytics";

/** users, total, iOS users, iOS total, Android users, Android total */
export type EventCounts = [number, number, number, number, number, number];
/** all, iOS, Android */
export type PeopleCounts = [number, number, number];

export interface DailyRow {
  day: string;
  events: Record<string, EventCounts>;
  people: { act?: PeopleCounts; seen?: PeopleCounts };
}

const DAY_MS = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => new Date(utc(d) + n * DAY_MS).toISOString().slice(0, 10);

/** The live view's id. A stored report can't use it (the tab shows the live one). */
export const DAILY_VIEW_ID = "daily";

/** How far back the comparisons look: the last 7 days against the 28 before them. */
export const RECENT_DAYS = 7;
export const BASE_DAYS = 28;

type Num = number | null;

/** Mean of the last `n` values ending at each position; null until at least half of them exist. */
export function rollingMean(values: Num[], n = RECENT_DAYS): Num[] {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - n + 1), i + 1).filter((v): v is number => v != null);
    return slice.length >= Math.ceil(n / 2) ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
  });
}

/**
 * A rate over the last `n` days ending at each position, as sum over sum (so a
 * quiet day can't swing it), in percent. Null when the denominator is empty.
 */
export function rollingRate(num: Num[], den: Num[], n = RECENT_DAYS): Num[] {
  return num.map((_, i) => {
    let a = 0;
    let b = 0;
    for (let k = Math.max(0, i - n + 1); k <= i; k++) {
      if (num[k] == null || den[k] == null) continue;
      a += num[k] as number;
      b += den[k] as number;
    }
    return b > 0 ? (a / b) * 100 : null;
  });
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

/** A daily count for a headline: whole numbers once it is big enough for decimals not to matter. */
export function countLabel(v: number | null): string {
  if (v == null) return "–";
  return formatNumber(v >= 20 ? Math.round(v) : Math.round(v * 10) / 10);
}

export const rateLabel = (v: number | null) => (v == null ? "–" : `${formatNumber(Math.round(v * 10) / 10)}%`);

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

// ---- What the view shows -------------------------------------------------

const USERS = 0;
const TOTAL = 1;

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

export interface DailyViewResult {
  /** null when no complete day is stored yet. */
  view: View | null;
  /** The last complete Eastern day shown. */
  through: string | null;
  /** Events flagged as stopped, down or doubled. */
  attention: number;
}

/**
 * Build the Daily view. `today` is the current Eastern day: it and anything
 * later is left out, because a part-day reads as a crash on a daily chart.
 */
export function buildDailyView(rows: DailyRow[], opts: { today: string; windowDays: number }): DailyViewResult {
  const complete = rows.filter((r) => r.day < opts.today).sort((a, b) => a.day.localeCompare(b.day));
  if (!complete.length) return { view: null, through: null, attention: 0 };

  const through = complete[complete.length - 1].day;
  const windowDays = Math.max(7, Math.round(opts.windowDays));
  const first = complete[0].day;
  const wantedStart = addDays(through, -(windowDays + RECENT_DAYS + BASE_DAYS - 1));
  const start = first > wantedStart ? first : wantedStart;

  const byDay = new Map(complete.map((r) => [r.day, r]));
  const days: string[] = [];
  for (let d = start; d <= through; d = addDays(d, 1)) days.push(d);
  const shown = Math.min(windowDays, days.length);
  const shownDays = days.slice(-shown);

  /** One value per day in `days`; null where the whole day is missing, 0 where only the event is. */
  const column = (fn: (r: DailyRow) => number | undefined): Num[] =>
    days.map((d) => {
      const r = byDay.get(d);
      return r ? (fn(r) ?? 0) : null;
    });
  const eventColumn = (p: Pick) => column((r) => r.events[p.event]?.[p.field ?? USERS]);

  const countSeries = (label: string, values: Num[]): DailySeries => {
    const smooth = rollingMean(values);
    const { recent, pct } = recentVsBase(values);
    return {
      label,
      values: values.slice(-shown),
      smooth: smooth.slice(-shown),
      headline: countLabel(recent),
      note: `a day, 7-day average, ${changeNote(pct)}`,
    };
  };

  const rateSeries = (label: string, num: Num[], den: Num[]): DailySeries => {
    const daily = num.map((n, i) => (n != null && den[i] != null && (den[i] as number) > 0 ? (n / (den[i] as number)) * 100 : null));
    const smooth = rollingRate(num, den);
    const latest = smooth[smooth.length - 1];
    const before = rollingRate(num.slice(0, -RECENT_DAYS), den.slice(0, -RECENT_DAYS), BASE_DAYS);
    const base = before[before.length - 1] ?? null;
    const diff = latest != null && base != null ? Math.round((latest - base) * 10) / 10 : null;
    const versus =
      diff == null
        ? "not enough history to compare"
        : diff === 0
          ? "level with the 4 weeks before"
          : `${diff > 0 ? "+" : "−"}${formatNumber(Math.abs(diff))} ${Math.abs(diff) === 1 ? "point" : "points"} against the 4 weeks before`;
    return {
      label,
      values: daily.slice(-shown),
      smooth: smooth.slice(-shown),
      headline: rateLabel(latest),
      note: `over the last 7 days, ${versus}`,
      unit: "%",
    };
  };

  const hasData = (values: Num[]) => values.slice(-shown).some((v) => v != null && v > 0);
  const pickSeries = (picks: Pick[]) =>
    picks
      .map((p) => ({ p, values: eventColumn(p) }))
      .filter((x) => hasData(x.values))
      .map((x) => countSeries(x.p.label, x.values));

  const seriesBlock = (title: string, series: DailySeries[], caption?: string, half?: boolean): Block | null =>
    series.length ? { type: "series", title, caption, half, days: shownDays, series } : null;
  const blocks = (...bs: (Block | null)[]) => bs.filter((b): b is Block => b != null);

  // People
  const act = column((r) => r.people.act?.[0]);
  const seen = column((r) => r.people.seen?.[0]);
  const sessions = eventColumn({ label: "", event: "app_session_started" });
  const people: DailySeries[] = [
    countSeries("Did something by hand", act),
    countSeries("Had a screen up", seen),
    ...(hasData(sessions) ? [countSeries("Started a session", sessions)] : []),
  ];
  const phones: DailySeries[] = [
    countSeries("iPhone, did something by hand", column((r) => r.people.act?.[1])),
    countSeries("Android, did something by hand", column((r) => r.people.act?.[2])),
  ];

  // New people and trials
  const onboarding = eventColumn({ label: "", event: "onboarding_started" });
  const signUps = eventColumn({ label: "", event: "sign_up_completed" });
  const trials = eventColumn({ label: "", event: "trial_started" });
  const sum7 = (values: Num[]) => values.slice(-RECENT_DAYS).reduce<number>((a, v) => a + (v ?? 0), 0);

  // Push
  const sent = eventColumn({ label: "", event: "notification_sent", field: TOTAL });
  const opened = eventColumn({ label: "", event: "notification_opened", field: TOTAL });

  // Is every event still arriving
  const names = new Set<string>();
  const lookback = days.slice(-(RECENT_DAYS + BASE_DAYS));
  for (const d of lookback) for (const n of Object.keys(byDay.get(d)?.events ?? {})) names.add(n);
  const health = [...names].map((name) => {
    const totals = lookback.map((d) => byDay.get(d)?.events[name]?.[TOTAL] ?? 0);
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
  const mealsNow = recentVsBase(eventColumn({ label: "", event: "meal_logged" }));
  const trialsNow = recentVsBase(trials);

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
        blocks: blocks(seriesBlock("People a day", people, undefined, true), seriesBlock("By phone", phones, undefined, true)),
      },
      {
        id: "features",
        title: "What they do",
        intro: "People doing each thing a day. `meal_logged` misses some meal-logging days, so the real figure is higher (see Tracking).",
        blocks: blocks(seriesBlock("People a day, by feature", pickSeries(FEATURES))),
      },
      {
        id: "trials",
        title: "New people and trials",
        blocks: blocks(
          sum7(onboarding) > 0
            ? {
                type: "bars",
                title: "The last 7 days, start to trial",
                caption: "Each day's people added up, so someone whose onboarding spans midnight counts twice.",
                rows: [
                  { label: "Started onboarding", value: sum7(onboarding) },
                  { label: "Signed up", value: sum7(signUps) },
                  { label: "Started a trial", value: sum7(trials) },
                ],
              }
            : null,
          seriesBlock("New people a day", [
            countSeries("Started onboarding", onboarding),
            countSeries("Started a trial", trials),
            rateSeries("Trial starts per onboarding start", trials, onboarding),
          ]),
          seriesBlock(
            "Subscription events",
            pickSeries(SUBSCRIPTIONS),
            "As RevenueCat reports them to Mixpanel. The Overview's trial count is the real total; this one runs slightly under it.",
          ),
        ),
      },
      {
        id: "screens",
        title: "Paywall and subscription screens",
        intro: "Opening subscription settings early in a trial went with a much lower paid rate (see Stay), so that chart is an early read on cancels.",
        blocks: blocks(seriesBlock("People a day", pickSeries(SCREENS))),
      },
      {
        id: "push",
        title: "Push notifications",
        blocks: blocks(
          hasData(sent)
            ? seriesBlock("Sends and taps a day", [
                countSeries("Notifications sent", sent),
                countSeries("Notifications tapped", opened),
                rateSeries("Share of sends tapped", opened, sent),
              ])
            : null,
        ),
      },
      {
        id: "health",
        title: "Health sync",
        intro: "A failed sync does not mean the data is missing: most people with a failure still get their steps that day (see Next).",
        blocks: blocks(seriesBlock("People a day", pickSeries(HEALTH))),
      },
      {
        id: "arriving",
        title: "Is every event still arriving",
        intro:
          "Each event's last 7 days against the 4 weeks before. An event that stops or halves is flagged here the next morning.",
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

  const view: View = {
    id: DAILY_VIEW_ID,
    label: "Daily",
    intro:
      "Mixpanel's own counts by Eastern day. The thick line is the 7-day average and the thin line is each day. Each chart prints its own scale underneath; one that does not start at zero is zoomed in to show the movement.",
    sections: sections.filter((s) => s.blocks.length > 0),
  };

  return { view, through, attention: flagged.length };
}
