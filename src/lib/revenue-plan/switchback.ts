/**
 * Meta holdout tests (switchback and step-down), config-driven. PURE: the
 * configs, the stats and the rules. switchback-data.ts assembles the days.
 *
 * Why it exists: the October step-down (SCALING iOS cut to $200/day on
 * Oct 14) silently broke on day 3, when the campaign went back to ~$700/day,
 * and nobody saw it for two weeks. Every test is now a table of phases with
 * the planned daily budget per campaign; actual spend is checked against it
 * every day and anything more than 20% off raises a marketing_alerts row.
 *
 * The read (vault: wiki/revenue-100k-question.md, "Clean holdout"):
 *  - Metric: RevenueCat iOS trials/day, high arm vs low arm, adjusted for
 *    Android trials/day (Android's spend never changes, so it carries the
 *    organic and seasonal swings both platforms share).
 *  - Incremental cost per trial = extra iOS spend/day / extra iOS trials/day,
 *    with a 90% interval from the trials effect.
 *  - Rule: keep the high spend only if that cost is at or below a Meta trial's
 *    12-month net value. Otherwise run low, then test $0 for a week. Extend 2
 *    weeks if the 90% interval is wider than +/-25% of the effect, unless the
 *    whole interval already sits on one side of break-even.
 * Pinned by tests/switchback.test.ts.
 */
import { dayDiff } from "./dates";

export type Arm = "high" | "low";

export interface PlannedCampaign {
  id: string;
  name: string;
  platform: "ios" | "android";
}

export interface Phase {
  from: string; // YYYY-MM-DD, inclusive (US/Eastern days)
  to: string;
  arm: Arm;
  /** Planned $/day by campaign id. 0 = must stay paused. */
  budgets: Record<string, number>;
  /** Status quo rather than a plan (a step-down's baseline): shown, never checked against the budgets. */
  observed?: boolean;
}

export interface HoldoutTest {
  id: string;
  title: string;
  /** draft = not approved or dates not set: shown, never alerted or emailed. */
  status: "draft" | "live" | "done";
  summary: string;
  campaigns: PlannedCampaign[];
  phases: Phase[];
  /** Days in a phase that count for neither arm (a budget changed mid-day). */
  excludeDays?: string[];
  minDaysPerArm: number;
  /** Extend when the effect's 90% half-width exceeds this share of the effect. */
  maxRelHalfWidth: number;
  extendWeeks: number;
  notes?: string[];
}

const SCALING_IOS: PlannedCampaign = { id: "120249101441350622", name: "SCALING Campaign (iOS)", platform: "ios" };
const TESTING_IOS: PlannedCampaign = { id: "120249182914140622", name: "TESTING Campaign (iOS)", platform: "ios" };
const EAC_TEST_IOS: PlannedCampaign = { id: "120249773881320622", name: "EAC Test (iOS) website", platform: "ios" };
const EAC_LEADS_IOS: PlannedCampaign = { id: "120250056777860622", name: "EAC Leads (iOS) website", platform: "ios" };
const SCALING_ANDROID: PlannedCampaign = { id: "120249131433200622", name: "SCALING Campaign (Android)", platform: "android" };

const switchbackBudgets = (iosDaily: number) => ({
  [SCALING_IOS.id]: iosDaily,
  [TESTING_IOS.id]: 0,
  [EAC_TEST_IOS.id]: 0,
  [EAC_LEADS_IOS.id]: 0,
  [SCALING_ANDROID.id]: 190,
});

export const HOLDOUT_TESTS: HoldoutTest[] = [
  {
    id: "ios-switchback-2026-11",
    title: "Meta iOS switchback",
    status: "draft",
    summary:
      "SCALING iOS alternates $700/day and $200/day by week for 4 weeks. Android stays untouched as the control. No creative or targeting edits during the test.",
    campaigns: [SCALING_IOS, TESTING_IOS, EAC_TEST_IOS, EAC_LEADS_IOS, SCALING_ANDROID],
    phases: [
      { from: "2026-11-16", to: "2026-11-22", arm: "high", budgets: switchbackBudgets(700) },
      { from: "2026-11-23", to: "2026-11-29", arm: "low", budgets: switchbackBudgets(200) },
      { from: "2026-11-30", to: "2026-12-06", arm: "high", budgets: switchbackBudgets(700) },
      { from: "2026-12-07", to: "2026-12-13", arm: "low", budgets: switchbackBudgets(200) },
    ],
    minDaysPerArm: 14,
    maxRelHalfWidth: 0.25,
    extendWeeks: 2,
    notes: [
      "Draft: needs Dan's OK. Dates are placeholders until the pre-flight is done.",
      "Pre-flight: find what put SCALING iOS back to ~$700/day on Oct 16 and pause any automated rules.",
      "Switch budgets at midnight Eastern so no day mixes two arms; otherwise list the day in excludeDays.",
      "Set the Android budget here to its live value on day 1; it must not change during the test.",
    ],
  },
  {
    id: "ios-stepdown-2026-10",
    title: "Meta iOS step-down (October)",
    status: "done",
    summary:
      "SCALING iOS cut from $600 to $200/day on Oct 14 and TESTING iOS paused. It broke on Oct 16, when SCALING iOS went back to ~$700/day; no verdict was filed.",
    campaigns: [SCALING_IOS, TESTING_IOS, SCALING_ANDROID],
    phases: [
      {
        from: "2026-10-01",
        to: "2026-10-13",
        arm: "high",
        budgets: { [SCALING_IOS.id]: 600, [TESTING_IOS.id]: 150, [SCALING_ANDROID.id]: 190 },
        observed: true,
      },
      {
        from: "2026-10-15",
        to: "2026-10-28",
        arm: "low",
        budgets: { [SCALING_IOS.id]: 200, [TESTING_IOS.id]: 0, [SCALING_ANDROID.id]: 190 },
      },
    ],
    minDaysPerArm: 7,
    maxRelHalfWidth: 0.25,
    extendWeeks: 2,
    notes: ["EAC Leads (iOS) ran Oct 16-21 at ~$100/day with Dan's OK, which also contaminates the low arm."],
  },
];

export const findTest = (id: string | null | undefined) => HOLDOUT_TESTS.find((t) => t.id === id) ?? null;

/** The test to open by default: a live one, else the next draft, else the newest. */
export function defaultTest(): HoldoutTest {
  return HOLDOUT_TESTS.find((t) => t.status === "live") ?? HOLDOUT_TESTS.find((t) => t.status === "draft") ?? HOLDOUT_TESTS[0];
}

export const testSpan = (t: HoldoutTest) => ({ from: t.phases[0].from, to: t.phases[t.phases.length - 1].to });

export function phaseOf(t: HoldoutTest, date: string): Phase | null {
  if (t.excludeDays?.includes(date)) return null;
  return t.phases.find((p) => date >= p.from && date <= p.to) ?? null;
}

export interface SwitchbackDay {
  date: string;
  /** Spend by campaign id, every campaign that spent (planned or not). */
  spend: Record<string, number>;
  iosSpend: number;
  androidSpend: number;
  /** RevenueCat trial starts: APP_STORE and PLAY_STORE. */
  iosTrials: number;
  androidTrials: number;
  /** Meta's own count (ad_insights_daily.trial_starts) on iOS campaigns. */
  iosMetaReported: number;
  /** iOS trials whose onboarding answer was Facebook/Instagram vs anything else; null without sources. */
  iosSaidMeta: number | null;
  iosSaidOther: number | null;
}

// ── Spend against plan ───────────────────────────────────────────────────

/** Spend under this on a campaign planned at $0 is pocket change, not a breach. */
export const ZERO_PLAN_TOLERANCE = 10;
export const WARN_DEVIATION = 0.2;
export const CRITICAL_DEVIATION = 0.5;

export interface Deviation {
  date: string;
  campaignId: string;
  campaignName: string;
  /** null = the campaign is not in the plan at all. */
  planned: number | null;
  actual: number;
  /** (actual - planned) / planned; null when planned is 0 or missing. */
  deviation: number | null;
  severity: "warn" | "critical";
  message: string;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;

/** Every complete in-phase day, every campaign: is actual spend within 20% of plan? */
export function planDeviations(
  t: HoldoutTest,
  days: SwitchbackDay[],
  today: string,
  names: Record<string, string> = {},
): Deviation[] {
  const nameOf = (id: string) => t.campaigns.find((c) => c.id === id)?.name ?? names[id] ?? id;
  const out: Deviation[] = [];
  for (const d of days) {
    if (d.date >= today) continue;
    const phase = phaseOf(t, d.date);
    if (!phase || phase.observed) continue;
    const ids = new Set([...Object.keys(phase.budgets), ...Object.keys(d.spend)]);
    for (const id of ids) {
      const actual = d.spend[id] ?? 0;
      const planned = id in phase.budgets ? phase.budgets[id] : null;
      const name = nameOf(id);
      if (planned == null) {
        if (actual > ZERO_PLAN_TOLERANCE) {
          out.push({
            date: d.date,
            campaignId: id,
            campaignName: name,
            planned: null,
            actual,
            deviation: null,
            severity: "warn",
            message: `${name} spent ${usd(actual)} on ${d.date} but is not in the ${t.title} plan.`,
          });
        }
        continue;
      }
      if (planned === 0) {
        if (actual > ZERO_PLAN_TOLERANCE) {
          out.push({
            date: d.date,
            campaignId: id,
            campaignName: name,
            planned,
            actual,
            deviation: null,
            severity: "critical",
            message: `${name} spent ${usd(actual)} on ${d.date}; the ${t.title} plan has it paused.`,
          });
        }
        continue;
      }
      const dev = (actual - planned) / planned;
      if (Math.abs(dev) <= WARN_DEVIATION) continue;
      out.push({
        date: d.date,
        campaignId: id,
        campaignName: name,
        planned,
        actual,
        deviation: dev,
        severity: Math.abs(dev) > CRITICAL_DEVIATION ? "critical" : "warn",
        message: `${name} spent ${usd(actual)} on ${d.date} vs ${usd(planned)} planned (${pct(dev)}), ${phase.arm} arm of the ${t.title}.`,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.campaignName.localeCompare(b.campaignName));
}

// ── Stats ────────────────────────────────────────────────────────────────

export interface ArmStats {
  days: number;
  iosTrials: number; // mean per day
  iosTrialsSd: number;
  androidTrials: number;
  iosSpend: number;
  androidSpend: number;
  iosMetaReported: number;
  iosSaidMeta: number | null;
  iosSaidOther: number | null;
}

export interface Estimate {
  method: "android-adjusted" | "raw";
  /** Extra iOS trials/day in the high arm. */
  effect: number;
  se: number;
  low90: number;
  high90: number;
}

const Z90 = 1.645;
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const variance = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
};

export function armStats(rows: SwitchbackDay[]): ArmStats {
  const survey = rows.filter((r) => r.iosSaidMeta != null && r.iosSaidOther != null);
  const surveyOk = rows.length > 0 && survey.length === rows.length;
  return {
    days: rows.length,
    iosTrials: mean(rows.map((r) => r.iosTrials)),
    iosTrialsSd: Math.sqrt(variance(rows.map((r) => r.iosTrials))),
    androidTrials: mean(rows.map((r) => r.androidTrials)),
    iosSpend: mean(rows.map((r) => r.iosSpend)),
    androidSpend: mean(rows.map((r) => r.androidSpend)),
    iosMetaReported: mean(rows.map((r) => r.iosMetaReported)),
    iosSaidMeta: surveyOk ? mean(survey.map((r) => r.iosSaidMeta!)) : null,
    iosSaidOther: surveyOk ? mean(survey.map((r) => r.iosSaidOther!)) : null,
  };
}

/** Difference in mean iOS trials/day, pooled within-arm variance. */
export function rawEstimate(high: SwitchbackDay[], low: SwitchbackDay[]): Estimate | null {
  const nh = high.length;
  const nl = low.length;
  if (nh < 2 || nl < 2) return null;
  const yh = high.map((r) => r.iosTrials);
  const yl = low.map((r) => r.iosTrials);
  const pooled = ((nh - 1) * variance(yh) + (nl - 1) * variance(yl)) / (nh + nl - 2);
  const effect = mean(yh) - mean(yl);
  const se = Math.sqrt(pooled * (1 / nh + 1 / nl));
  return { method: "raw", effect, se, low90: effect - Z90 * se, high90: effect + Z90 * se };
}

/** Inverse of a 3x3 matrix; null when singular. */
function inv3(m: number[][]): number[][] | null {
  const [a, b, c] = m[0];
  const [d, e, f] = m[1];
  const [g, h, i] = m[2];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/**
 * OLS: iosTrials = a + effect x high + b x androidTrials. Android's spend is
 * held fixed, so its trials carry the swings both platforms share (season,
 * holidays, organic drift); adjusting for them removes that noise.
 */
export function adjustedEstimate(high: SwitchbackDay[], low: SwitchbackDay[]): Estimate | null {
  const rows = [...high.map((r) => ({ r, x: 1 })), ...low.map((r) => ({ r, x: 0 }))];
  const n = rows.length;
  if (high.length < 2 || low.length < 2 || n < 5) return null;
  const X = rows.map(({ r, x }) => [1, x, r.androidTrials]);
  const y = rows.map(({ r }) => r.iosTrials);
  const xtx = [0, 1, 2].map((i) => [0, 1, 2].map((j) => X.reduce((s, row) => s + row[i] * row[j], 0)));
  const xty = [0, 1, 2].map((i) => X.reduce((s, row, k) => s + row[i] * y[k], 0));
  const inv = inv3(xtx);
  if (!inv) return null;
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j], 0));
  const rss = X.reduce((s, row, k) => s + (y[k] - (beta[0] + beta[1] * row[1] + beta[2] * row[2])) ** 2, 0);
  const sigma2 = rss / (n - 3);
  const se = Math.sqrt(Math.max(0, sigma2 * inv[1][1]));
  const effect = beta[1];
  return { method: "android-adjusted", effect, se, low90: effect - Z90 * se, high90: effect + Z90 * se };
}

export type VerdictStatus = "draft" | "not_started" | "collecting" | "invalid" | "keep_high" | "run_low" | "extend";

export interface SwitchbackSummary {
  test: HoldoutTest;
  high: ArmStats;
  low: ArmStats;
  /** Extra iOS spend/day in the high arm (actual, not planned). */
  spendDelta: number;
  /** The same gap as planned (an observed phase counts its actual spend); null before any test day. */
  plannedSpendDelta: number | null;
  raw: Estimate | null;
  adjusted: Estimate | null;
  /** The estimate the verdict uses: Android-adjusted when it can be fitted. */
  primary: Estimate | null;
  /** Incremental cost per trial and its 90% interval; cptHigh null = unbounded. */
  cpt: number | null;
  cptLow: number | null;
  cptHigh: number | null;
  breakEven: { value: number; basis: string };
  deviations: Deviation[];
  daysIn: number;
  daysTotal: number;
  verdict: { status: VerdictStatus; headline: string; detail: string };
}

const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Below this share of the planned spend gap between arms, the test has no read. */
export const MIN_REALIZED_GAP = 0.5;

export function summarize(
  t: HoldoutTest,
  days: SwitchbackDay[],
  today: string,
  breakEven: { value: number; basis: string },
  names: Record<string, string> = {},
): SwitchbackSummary {
  const span = testSpan(t);
  const counted = (d: SwitchbackDay) => d.date < today && phaseOf(t, d.date) != null;
  const high = days.filter((d) => counted(d) && phaseOf(t, d.date)!.arm === "high");
  const low = days.filter((d) => counted(d) && phaseOf(t, d.date)!.arm === "low");
  const hs = armStats(high);
  const ls = armStats(low);
  const raw = rawEstimate(high, low);
  const adjusted = adjustedEstimate(high, low);
  const primary = adjusted ?? raw;
  const spendDelta = hs.iosSpend - ls.iosSpend;
  const iosIds = new Set(t.campaigns.filter((c) => c.platform === "ios").map((c) => c.id));
  const plannedIos = (d: SwitchbackDay) => {
    const ph = phaseOf(t, d.date)!;
    return ph.observed ? d.iosSpend : Object.entries(ph.budgets).reduce((s, [id, v]) => s + (iosIds.has(id) ? v : 0), 0);
  };
  const plannedSpendDelta = high.length && low.length ? mean(high.map(plannedIos)) - mean(low.map(plannedIos)) : null;

  let cpt: number | null = null;
  let cptLow: number | null = null;
  let cptHigh: number | null = null;
  if (primary && spendDelta > 0) {
    if (primary.effect > 0) cpt = spendDelta / primary.effect;
    if (primary.high90 > 0) cptLow = spendDelta / primary.high90;
    if (primary.low90 > 0) cptHigh = spendDelta / primary.low90;
  }

  const plannedDays = t.phases.reduce((s, p) => s + dayDiff(p.from, p.to) + 1, 0) - (t.excludeDays?.length ?? 0);
  const daysIn = high.length + low.length;
  const be = breakEven.value;
  const ended = today > span.to;
  const enough = hs.days >= t.minDaysPerArm && ls.days >= t.minDaysPerArm;

  let verdict: SwitchbackSummary["verdict"];
  const running = primary
    ? `High arm adds ${one(primary.effect)} iOS trials/day (90% ${one(primary.low90)} to ${one(primary.high90)}) for ${usd(spendDelta)}/day more spend.`
    : "";
  if (t.status === "draft") {
    verdict = {
      status: "draft",
      headline: `Draft, starts ${span.from} once Dan approves`,
      detail: t.summary,
    };
  } else if (daysIn === 0) {
    verdict = { status: "not_started", headline: `Starts ${span.from}`, detail: t.summary };
  } else if (!primary || !enough || (!ended && t.status === "live")) {
    verdict = {
      status: "collecting",
      headline: ended ? "Ended without enough days for a verdict" : `Day ${daysIn} of ${plannedDays}: too early to call`,
      detail: `${running} A verdict needs ${t.minDaysPerArm}+ complete days in each arm${ended ? "" : " and the last phase to finish"}.`.trim(),
    };
  } else if (spendDelta <= 0) {
    verdict = {
      status: "invalid",
      headline: "No read: the high arm did not spend more than the low arm",
      detail: `High arm ${usd(hs.iosSpend)}/day vs low arm ${usd(ls.iosSpend)}/day of iOS spend. Check the spend-vs-plan table.`,
    };
  } else if (plannedSpendDelta != null && plannedSpendDelta > 0 && spendDelta < MIN_REALIZED_GAP * plannedSpendDelta) {
    verdict = {
      status: "invalid",
      headline: `No read: the plan broke, the arms were ${usd(spendDelta)}/day apart, not ${usd(plannedSpendDelta)}`,
      detail: `High arm ${usd(hs.iosSpend)}/day vs low arm ${usd(ls.iosSpend)}/day of iOS spend. With under ${Math.round(MIN_REALIZED_GAP * 100)}% of the planned gap there is too little dose to read. ${running}`,
    };
  } else if (primary.high90 <= 0) {
    verdict = {
      status: "run_low",
      headline: "High spend bought no measurable trials: run low",
      detail: `${running} Next: run low, then test $0 for a week.`,
    };
  } else if (cptLow != null && cptLow > be) {
    verdict = {
      status: "run_low",
      headline: `Even the best case (${usd(cptLow)}/trial) is above break-even: run low`,
      detail: `${running} Break-even is ${usd(be)} (${breakEven.basis}). Next: run low, then test $0 for a week.`,
    };
  } else if (cptHigh != null && cptHigh <= be) {
    verdict = {
      status: "keep_high",
      headline: `Keep high: even the worst case (${usd(cptHigh)}/trial) is under break-even`,
      detail: `${running} Break-even is ${usd(be)} (${breakEven.basis}).`,
    };
  } else if (primary.se * Z90 > t.maxRelHalfWidth * Math.abs(primary.effect)) {
    verdict = {
      status: "extend",
      headline: `Too wide to call: extend ${t.extendWeeks} weeks`,
      detail: `${running} The 90% interval is wider than +/-${Math.round(t.maxRelHalfWidth * 100)}% and straddles break-even (${usd(be)}).`,
    };
  } else if (cpt != null && cpt <= be) {
    verdict = {
      status: "keep_high",
      headline: `Keep high: ${usd(cpt)} per extra trial vs ${usd(be)} break-even`,
      detail: `${running} Break-even is ${usd(be)} (${breakEven.basis}).`,
    };
  } else {
    verdict = {
      status: "run_low",
      headline: `Run low: ${cpt != null ? usd(cpt) : "n/a"} per extra trial vs ${usd(be)} break-even`,
      detail: `${running} Next: run low, then test $0 for a week.`,
    };
  }

  return {
    test: t,
    high: hs,
    low: ls,
    spendDelta,
    plannedSpendDelta,
    raw,
    adjusted,
    primary,
    cpt,
    cptLow,
    cptHigh,
    breakEven,
    deviations: planDeviations(t, days, today, names),
    daysIn,
    daysTotal: plannedDays,
    verdict,
  };
}

/** Plain-text report for the daily email (no em dashes; Dan's house rule). */
export function reportText(s: SwitchbackSummary, days: SwitchbackDay[], today: string): string {
  const lines = [s.verdict.headline, s.verdict.detail, ""];
  const recentBreaks = s.deviations.filter((d) => d.severity === "critical");
  if (recentBreaks.length) {
    lines.push(`SPEND OFF PLAN (${recentBreaks.length} campaign-days over 50%):`);
    for (const d of recentBreaks.slice(-5)) lines.push(`  ${d.message}`);
    lines.push("");
  }
  const arm = (label: string, a: ArmStats) =>
    `${label} (${a.days} days): ${one(a.iosTrials)} iOS trials/day on ${usd(a.iosSpend)}/day iOS spend, ${one(a.androidTrials)} Android trials/day, Meta reported ${one(a.iosMetaReported)} iOS trials/day.`;
  lines.push(arm("High arm", s.high), arm("Low arm", s.low));
  if (s.primary) {
    lines.push(
      `Extra trials/day at high spend: ${one(s.primary.effect)} (90% ${one(s.primary.low90)} to ${one(s.primary.high90)}, ${s.primary.method}).`,
      `Cost per extra trial: ${s.cpt != null ? usd(s.cpt) : "n/a"} (90% ${s.cptLow != null ? usd(s.cptLow) : "n/a"} to ${s.cptHigh != null ? usd(s.cptHigh) : "unbounded"}). Break-even ${usd(s.breakEven.value)} (${s.breakEven.basis}).`,
    );
  }
  const recent = days.filter((d) => d.date < today && phaseOf(s.test, d.date)).slice(-7);
  if (recent.length) {
    lines.push("", "Last days (date, arm: iOS trials, iOS spend, Android trials):");
    for (const d of recent) lines.push(`  ${d.date}, ${phaseOf(s.test, d.date)!.arm}: ${d.iosTrials}, ${usd(d.iosSpend)}, ${d.androidTrials}`);
  }
  return lines.join("\n");
}
