/**
 * Meta iOS spend step-down test (2026-10-14) — is Meta actually driving trials?
 *
 * Meta's own reporting claims more iOS trials than RevenueCat records from
 * every source combined, so it cannot answer "is the campaign working". This
 * test does: SCALING Campaign (iOS) was cut from $600 to $200/day on Oct 14
 * (TESTING iOS paused the same day) and nothing else changed. If Meta drives
 * trials, total RevenueCat iOS trials fall; if they hold, the spend was not
 * buying much. Android (spend unchanged) and the onboarding "how did you hear
 * about us" answers are the controls.
 *
 * Sizing (Sep daily iOS trials: mean 56, sd ~10): over 14 days a $380/day cut
 * shows a ~16/day drop at a $23 marginal cost per trial (z ~ 4) and ~7/day at
 * $51 (z ~ 2). Decision rules were agreed with Dan before the test started:
 *   drop >= 14/day  -> Meta is worth ~$23/trial; restore spend toward break-even
 *   drop <= 7/day   -> the extra spend was mostly wasted; keep it low
 *
 * The stats are pure (summarize) and pinned by tests/step-down.test.ts; the
 * fetchers below only assemble the daily rows.
 */

export interface DateWindow {
  from: string; // YYYY-MM-DD, inclusive (US/Eastern days)
  to: string;
}

export interface StepDownConfig {
  title: string;
  campaignId: string;
  campaignName: string;
  oldDailyBudget: number;
  newDailyBudget: number;
  /** The day the budget changed; excluded from both windows. */
  transition: string;
  baseline: DateWindow;
  test: DateWindow;
  /** Trials/day drop at or above which Meta is judged to be working. */
  workingDrop: number;
  /** Trials/day drop at or below which the extra spend is judged wasted. */
  wastedDrop: number;
  /** No verdict before this many complete test days. */
  minDays: number;
}

export const STEP_DOWN: StepDownConfig = {
  title: "Meta iOS spend step-down",
  campaignId: "120249101441350622",
  campaignName: "SCALING Campaign (iOS)",
  oldDailyBudget: 600,
  newDailyBudget: 200,
  transition: "2026-10-14",
  baseline: { from: "2026-10-01", to: "2026-10-13" },
  test: { from: "2026-10-15", to: "2026-10-28" },
  workingDrop: 14,
  wastedDrop: 7,
  minDays: 7,
};

export interface DayRow {
  date: string;
  iosSpend: number;
  androidSpend: number;
  iosTrials: number;
  androidTrials: number;
  /** iOS trials whose onboarding answer was facebook or instagram; null if Mixpanel is unavailable. */
  iosSurveyMeta: number | null;
  /** iOS trials with any other onboarding answer. */
  iosSurveyOther: number | null;
}

export interface WindowStats {
  days: number;
  iosTrials: number; // mean per day
  iosTrialsSd: number;
  androidTrials: number;
  iosSpend: number;
  androidSpend: number;
  iosSurveyMeta: number | null;
  iosSurveyOther: number | null;
}

export type VerdictStatus = "not_started" | "collecting" | "working" | "wasted" | "in_between";

export interface StepDownSummary {
  config: StepDownConfig;
  baseline: WindowStats;
  test: WindowStats;
  /** Complete test days so far. */
  daysIn: number;
  daysTotal: number;
  /** Baseline minus test iOS trials/day (positive = trials fell). */
  drop: number;
  /** Drop after scaling the baseline by Android's own change (control). */
  dropAndroidAdjusted: number | null;
  /** Standard error of `drop` and its 95% interval. */
  se: number;
  low: number;
  high: number;
  z: number;
  /** Fall in iOS Meta spend per day, baseline minus test. */
  spendCut: number;
  /** spendCut / drop: what each lost trial had been costing. Null when trials did not fall. */
  costPerLostTrial: number | null;
  /** Android trials/day change as a share of baseline; a big move means something else changed. */
  androidChange: number | null;
  verdict: { status: VerdictStatus; headline: string; detail: string };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
const inWindow = (d: string, w: DateWindow) => d >= w.from && d <= w.to;

function windowStats(rows: DayRow[]): WindowStats {
  const survey = rows.filter((r) => r.iosSurveyMeta != null && r.iosSurveyOther != null);
  const surveyOk = rows.length > 0 && survey.length === rows.length;
  return {
    days: rows.length,
    iosTrials: mean(rows.map((r) => r.iosTrials)),
    iosTrialsSd: sd(rows.map((r) => r.iosTrials)),
    androidTrials: mean(rows.map((r) => r.androidTrials)),
    iosSpend: mean(rows.map((r) => r.iosSpend)),
    androidSpend: mean(rows.map((r) => r.androidSpend)),
    iosSurveyMeta: surveyOk ? mean(survey.map((r) => r.iosSurveyMeta!)) : null,
    iosSurveyOther: surveyOk ? mean(survey.map((r) => r.iosSurveyOther!)) : null,
  };
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/**
 * `rows` may cover any span; only complete days inside the two windows count.
 * `today` (YYYY-MM-DD, Eastern) marks the first incomplete day.
 */
export function summarize(cfg: StepDownConfig, rows: DayRow[], today: string): StepDownSummary {
  const complete = rows.filter((r) => r.date < today);
  const base = complete.filter((r) => inWindow(r.date, cfg.baseline));
  const tst = complete.filter((r) => inWindow(r.date, cfg.test));
  const baseline = windowStats(base);
  const test = windowStats(tst);
  const daysTotal =
    Math.round((Date.parse(`${cfg.test.to}T00:00:00Z`) - Date.parse(`${cfg.test.from}T00:00:00Z`)) / 86_400_000) + 1;

  // Nothing to compare until the first complete test day.
  const drop = test.days ? baseline.iosTrials - test.iosTrials : 0;
  // Same day-to-day noise assumed in both windows; the baseline estimates it.
  const noise = baseline.iosTrialsSd;
  const se = test.days && baseline.days ? Math.sqrt(noise ** 2 / baseline.days + noise ** 2 / test.days) : 0;
  const z = se > 0 ? drop / se : 0;
  const spendCut = baseline.iosSpend - test.iosSpend;
  const costPerLostTrial = drop > 0 && spendCut > 0 ? spendCut / drop : null;
  const androidChange =
    baseline.androidTrials > 0 && test.days ? (test.androidTrials - baseline.androidTrials) / baseline.androidTrials : null;
  const dropAndroidAdjusted =
    androidChange != null ? baseline.iosTrials * (1 + androidChange) - test.iosTrials : null;

  let verdict: StepDownSummary["verdict"];
  if (test.days === 0) {
    verdict = {
      status: "not_started",
      headline: `Test starts ${cfg.test.from}`,
      detail: `Baseline: ${one(baseline.iosTrials)} iOS trials/day on ${usd(baseline.iosSpend)}/day of iOS Meta spend.`,
    };
  } else if (test.days < cfg.minDays) {
    verdict = {
      status: "collecting",
      headline: `Day ${test.days} of ${daysTotal}: too early to call`,
      detail: `iOS trials ${drop >= 0 ? "down" : "up"} ${one(Math.abs(drop))}/day so far (95% range ${one(drop - 2 * se)} to ${one(drop + 2 * se)}). A verdict needs ${cfg.minDays}+ days.`,
    };
  } else if (drop >= cfg.workingDrop) {
    verdict = {
      status: "working",
      headline: `Meta is driving trials: down ${one(drop)}/day`,
      detail: `Each trial lost cost about ${costPerLostTrial ? usd(costPerLostTrial) : "n/a"} in spend. Meta is doing real work; set spend to what pays back at that price.`,
    };
  } else if (drop <= cfg.wastedDrop) {
    verdict = {
      status: "wasted",
      headline: `Trials held: down only ${one(drop)}/day`,
      detail: `Cutting ${usd(spendCut)}/day lost at most ${one(Math.max(drop, 0))} trials/day${costPerLostTrial ? ` (${usd(costPerLostTrial)} per lost trial)` : ""}. The extra spend was mostly wasted; keep it low and rebuild slowly.`,
    };
  } else {
    verdict = {
      status: "in_between",
      headline: `In between: down ${one(drop)}/day`,
      detail: `About ${costPerLostTrial ? usd(costPerLostTrial) : "n/a"} per lost trial: Meta works, but the cut spend was expensive. Restore part of it and recheck.`,
    };
  }

  return {
    config: cfg,
    baseline,
    test,
    daysIn: test.days,
    daysTotal,
    drop,
    dropAndroidAdjusted,
    se,
    low: drop - 2 * se,
    high: drop + 2 * se,
    z,
    spendCut,
    costPerLostTrial,
    androidChange,
    verdict,
  };
}

/** Plain-text report for the daily email (no em dashes; Dan's house rule). */
export function reportText(s: StepDownSummary, rows: DayRow[]): string {
  const b = s.baseline;
  const t = s.test;
  const lines = [
    `${s.verdict.headline}`,
    s.verdict.detail,
    "",
    `Baseline (${s.config.baseline.from} to ${s.config.baseline.to}, ${b.days} days): ${one(b.iosTrials)} iOS trials/day, ${usd(b.iosSpend)}/day iOS Meta spend, ${one(b.androidTrials)} Android trials/day.`,
  ];
  if (t.days) {
    lines.push(
      `Test so far (${t.days} of ${s.daysTotal} days): ${one(t.iosTrials)} iOS trials/day, ${usd(t.iosSpend)}/day iOS Meta spend, ${one(t.androidTrials)} Android trials/day.`,
      `Drop: ${one(s.drop)}/day (95% range ${one(s.low)} to ${one(s.high)}). Android-adjusted: ${s.dropAndroidAdjusted == null ? "n/a" : `${one(s.dropAndroidAdjusted)}/day`}.`,
    );
  } else {
    lines.push(`Test window: ${s.config.test.from} to ${s.config.test.to} (${s.daysTotal} days).`);
  }
  if (t.days && b.iosSurveyMeta != null && t.iosSurveyMeta != null) {
    lines.push(
      `Survey, iOS trials/day saying Facebook or Instagram: ${one(b.iosSurveyMeta)} before, ${one(t.iosSurveyMeta)} now. Everyone else: ${one(b.iosSurveyOther ?? 0)} before, ${one(t.iosSurveyOther ?? 0)} now.`,
    );
  }
  if (s.androidChange != null && Math.abs(s.androidChange) > 0.2) {
    lines.push(`Warning: Android trials moved ${Math.round(s.androidChange * 100)}% with no spend change, so something else may be moving trials too.`);
  }
  const recent = rows.filter((r) => r.date >= s.config.test.from).slice(-7);
  if (recent.length) {
    lines.push("", "Last days (date: iOS trials, iOS spend, Android trials):");
    for (const r of recent) lines.push(`  ${r.date}: ${r.iosTrials}, ${usd(r.iosSpend)}, ${r.androidTrials}`);
  }
  lines.push("", "Rules agreed before the test: a drop of 14+/day means Meta is working; 7/day or less means the extra spend was wasted.");
  return lines.join("\n");
}

// ── I/O: assemble the daily rows ───────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";

export function stepDownDbConfigured(): boolean {
  return !!SUPABASE_URL && !!SERVICE_ROLE;
}

const ET_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** YYYY-MM-DD of an instant in US/Eastern (the account and Mixpanel timezone). */
export const easternDate = (iso: string | number | Date) => ET_DAY.format(new Date(iso));

async function sbAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}&limit=1000&offset=${offset}`, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Supabase ${res.status} (${path.split("?")[0]}): ${(await res.text()).slice(0, 200)}`);
    const page = (await res.json()) as T[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Facebook + Instagram answers count as Meta. */
export const META_SOURCES = new Set(["facebook", "instagram"]);

async function surveyByDay(from: string, to: string): Promise<Map<string, { meta: number; other: number }> | null> {
  const { segmentationOn, mixpanelConfigured } = await import("@/lib/vendors/mixpanel");
  if (!mixpanelConfigured()) return null;
  try {
    const bySource = await segmentationOn("trial_started", from, to, 'user["referral_source"]', 'properties["platform"]=="ios"');
    const out = new Map<string, { meta: number; other: number }>();
    for (const [source, days] of bySource) {
      for (const [date, n] of days) {
        const cur = out.get(date) ?? { meta: 0, other: 0 };
        if (META_SOURCES.has(source)) cur.meta += n;
        else cur.other += n;
        out.set(date, cur);
      }
    }
    return out;
  } catch {
    return null; // the survey is a control, never a reason to fail the page
  }
}

export async function fetchStepDownRows(cfg: StepDownConfig = STEP_DOWN, now = new Date()): Promise<{ rows: DayRow[]; today: string }> {
  const today = easternDate(now);
  const last = today < cfg.test.to ? today : cfg.test.to;
  const days = daysBetween(cfg.baseline.from, last);
  // Eastern midnight is 04:00 or 05:00 UTC; start a day early and bucket in code.
  const sinceUtc = new Date(Date.parse(`${cfg.baseline.from}T00:00:00Z`) - 86_400_000).toISOString();

  const [trials, spend, survey] = await Promise.all([
    sbAll<{ event_at: string; store: string | null }>(
      `rc_events?select=event_at,store&type=eq.INITIAL_PURCHASE&period_type=eq.TRIAL&environment=eq.PRODUCTION` +
        `&store=in.(APP_STORE,PLAY_STORE)&event_at=gte.${encodeURIComponent(sinceUtc)}&order=event_at.asc`,
    ),
    sbAll<{ date: string; campaign_name: string | null; spend: string | number | null }>(
      `ad_insights_daily?select=date,campaign_name,spend&date=gte.${cfg.baseline.from}&date=lte.${last}&order=date.asc`,
    ),
    surveyByDay(cfg.baseline.from, last),
  ]);

  const byDay = new Map<string, DayRow>(
    days.map((d) => [
      d,
      {
        date: d,
        iosSpend: 0,
        androidSpend: 0,
        iosTrials: 0,
        androidTrials: 0,
        iosSurveyMeta: survey ? (survey.get(d)?.meta ?? 0) : null,
        iosSurveyOther: survey ? (survey.get(d)?.other ?? 0) : null,
      },
    ]),
  );
  for (const t of trials) {
    const row = byDay.get(easternDate(t.event_at));
    if (!row) continue;
    if (t.store === "APP_STORE") row.iosTrials++;
    else row.androidTrials++;
  }
  for (const s of spend) {
    const row = byDay.get(String(s.date).slice(0, 10));
    if (!row) continue;
    const v = typeof s.spend === "number" ? s.spend : Number(s.spend) || 0;
    if (/android/i.test(s.campaign_name ?? "")) row.androidSpend += v;
    else row.iosSpend += v;
  }
  return { rows: [...byDay.values()], today };
}
