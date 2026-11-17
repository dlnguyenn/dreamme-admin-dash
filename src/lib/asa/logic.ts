/**
 * Pure Apple Ads tab logic, shared by /api/asa and the tab, pinned by
 * tests/asa-logic.test.ts. No I/O here.
 */

export interface AsaCampaignRow {
  campaign_id: number;
  name: string;
  status: string | null;
  serving_status: string | null;
  display_status: string | null;
  serving_reasons: string[];
  daily_budget: number | null;
  start_time: string | null;
  end_time: string | null;
  countries: string[];
  deleted: boolean;
  synced_at: string;
}

export interface AsaDailyRow {
  day: string;
  campaign_id: number;
  impressions: number;
  taps: number;
  tap_installs: number;
  view_installs: number;
  spend: number;
}

export interface AsaKeywordDailyRow extends AsaDailyRow {
  keyword_id: number;
  ad_group_id: number;
  keyword: string;
  match_type: string | null;
  bid: number | null;
}

export interface AsaTest {
  campaign_id: number;
  label: string;
  keep_cost_per_trial: number;
  stop_cost_per_trial: number;
  length_days: number;
  checkpoints: number[];
  started_on: string | null;
  notes: string;
}

export interface Totals {
  impressions: number;
  taps: number;
  tap_installs: number;
  view_installs: number;
  spend: number;
}

export const emptyTotals = (): Totals => ({ impressions: 0, taps: 0, tap_installs: 0, view_installs: 0, spend: 0 });

export function sumRows(rows: Pick<AsaDailyRow, keyof Totals>[]): Totals {
  const t = emptyTotals();
  for (const r of rows) {
    t.impressions += Number(r.impressions) || 0;
    t.taps += Number(r.taps) || 0;
    t.tap_installs += Number(r.tap_installs) || 0;
    t.view_installs += Number(r.view_installs) || 0;
    t.spend += Number(r.spend) || 0;
  }
  t.spend = Math.round(t.spend * 100) / 100;
  return t;
}

/** Ratios that are null rather than 0 or Infinity when the base is empty. */
export function ratios(t: Totals) {
  return {
    avg_cpt: t.taps > 0 ? t.spend / t.taps : null,
    tap_rate: t.impressions > 0 ? t.taps / t.impressions : null,
    tap_to_install: t.taps > 0 ? t.tap_installs / t.taps : null,
    cost_per_tap_install: t.tap_installs > 0 ? t.spend / t.tap_installs : null,
  };
}

/** YYYY-MM-DD n days before `day` (inclusive window start for an n-day window ending on `day`). */
export function windowStart(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (n - 1));
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export type Tone = "danger" | "warning" | "info" | "success";
export interface Warning {
  tone: Tone;
  text: string;
}

/**
 * What to flag on a campaign card.
 * - A test campaign switched on with no end date runs at its daily budget with
 *   no stop (Apple no longer takes a total budget): danger.
 * - Any campaign spending ≥95% of its daily cap on recent days misses searches.
 * - On but not serving: show Apple's reasons.
 */
export function campaignWarnings(
  c: AsaCampaignRow,
  daily: AsaDailyRow[],
  isTest: boolean,
  today: string,
): Warning[] {
  const out: Warning[] = [];
  const on = c.status === "ENABLED";
  if (isTest && on && !c.end_time) {
    out.push({ tone: "danger", text: "Test is on with no end date. It will spend its daily budget every day until someone stops it." });
  }
  if (on && c.daily_budget && c.daily_budget > 0) {
    const from = windowStart(today, 14);
    const recent = daily.filter((d) => d.campaign_id === c.campaign_id && d.day >= from);
    const capped = recent.filter((d) => d.spend >= 0.95 * (c.daily_budget as number)).length;
    if (capped >= 3) {
      out.push({ tone: "warning", text: `Hit its $${c.daily_budget}/day cap on ${capped} of the last 14 days, so some searches went unserved.` });
    }
  }
  if (on && c.serving_status !== "RUNNING") {
    const reasons = (c.serving_reasons ?? []).map(humanReason).join(", ");
    out.push({ tone: "info", text: `On, but not serving${reasons ? `: ${reasons}` : ""}.` });
  }
  if (c.end_time && on) {
    const end = c.end_time.slice(0, 10);
    if (end >= today) out.push({ tone: "info", text: `Stops on ${end}.` });
  }
  return out;
}

const REASONS: Record<string, string> = {
  PAUSED_BY_USER: "paused",
  NO_AVAILABLE_AD_GROUPS: "no ad group is on",
  AD_GROUP_PAUSED_BY_USER: "ad group paused",
  NO_PAYMENT_METHOD_ON_FILE: "no payment method",
  START_DATE_IN_THE_FUTURE: "start date is in the future",
  CAMPAIGN_END_DATE_REACHED: "end date passed",
  DAILY_CAP_EXHAUSTED: "daily cap used up",
  BUDGET_EXHAUSTED: "budget used up",
  CREDIT_CARD_DECLINED: "card declined",
};
export function humanReason(r: string): string {
  return REASONS[r] ?? r.toLowerCase().replace(/_/g, " ");
}

export interface TestRead {
  state: "not_started" | "running" | "ended";
  started_on: string | null; // recorded start, else the first day with spend
  day: number | null; // 1-based day of the test, null before start
  end_day: string | null;
  spend: number;
  budget_to_date: number | null;
  pace: number | null; // spend / (daily budget × days run)
  trials: number | null; // null = attribution not proven, so trials can't be counted
  cost_per_trial: number | null;
  next_checkpoint: number | null;
  verdict: { tone: Tone; text: string };
}

/**
 * The keep / stop read for a time-boxed test, on actual spend (not the
 * planned total). Trials are this campaign's only; null when the app's
 * Apple Ads attribution hasn't been seen in RevenueCat yet.
 */
export function readTest(
  t: AsaTest,
  c: AsaCampaignRow | undefined,
  daily: AsaDailyRow[],
  trials: number | null,
  today: string,
): TestRead {
  const budget = c?.daily_budget ?? null;
  // If nobody recorded the start, the first day it spent is the start.
  const firstSpend = daily.filter((d) => d.campaign_id === t.campaign_id && d.spend > 0).map((d) => d.day).sort()[0];
  const startedOn = t.started_on ?? firstSpend ?? null;
  if (!startedOn) {
    return {
      state: "not_started", started_on: null, day: null, end_day: null, spend: 0, budget_to_date: null, pace: null,
      trials, cost_per_trial: null, next_checkpoint: t.checkpoints[0] ?? null,
      verdict: { tone: "info", text: "Not started. It stays paused until the unpause rule is met." },
    };
  }
  const endDay = addDays(startedOn, t.length_days - 1);
  const lastDay = today < endDay ? today : endDay;
  const ran = Math.max(0, daysBetween(startedOn, lastDay) + 1);
  const rows = daily.filter((d) => d.campaign_id === t.campaign_id && d.day >= startedOn && d.day <= lastDay);
  const spend = sumRows(rows).spend;
  const budgetToDate = budget ? budget * ran : null;
  const pace = budgetToDate ? spend / budgetToDate : null;
  const cpt = trials != null && trials > 0 ? spend / trials : null;
  const state: TestRead["state"] = today > endDay ? "ended" : "running";
  const next = t.checkpoints.find((n) => n >= ran) ?? null;

  let verdict: TestRead["verdict"];
  if (trials == null) {
    verdict = { tone: "warning", text: "Can't count trials yet: no Apple Ads attribution seen in RevenueCat." };
  } else if (state === "running") {
    verdict = {
      tone: "info",
      text: `Day ${ran} of ${t.length_days}. Read at the end: keep at $${t.keep_cost_per_trial} or less per trial, stop above $${t.stop_cost_per_trial}.`,
    };
  } else if (trials === 0) {
    verdict = spend > 0
      ? { tone: "danger", text: `Ended with $${spend.toFixed(0)} spent and no trials. Stop.` }
      : { tone: "warning", text: "Ended without spending. It never served." };
  } else if (cpt! <= t.keep_cost_per_trial) {
    verdict = { tone: "success", text: `$${cpt!.toFixed(2)} per trial. Keep it and raise the budget.` };
  } else if (cpt! > t.stop_cost_per_trial) {
    verdict = { tone: "danger", text: `$${cpt!.toFixed(2)} per trial. Stop it.` };
  } else {
    verdict = { tone: "warning", text: `$${cpt!.toFixed(2)} per trial, between keep and stop. A judgment call.` };
  }
  return {
    state, started_on: startedOn, day: Math.min(ran, t.length_days), end_day: endDay, spend, budget_to_date: budgetToDate, pace,
    trials, cost_per_trial: cpt, next_checkpoint: next, verdict,
  };
}

/** Match a RevenueCat $campaign value (Apple's id or the campaign name) to a campaign id. */
export function matchCampaign(value: string | null, campaigns: Pick<AsaCampaignRow, "campaign_id" | "name">[]): number | null {
  if (!value) return null;
  const v = value.trim();
  const byId = campaigns.find((c) => String(c.campaign_id) === v);
  if (byId) return byId.campaign_id;
  const byName = campaigns.find((c) => c.name.trim().toLowerCase() === v.toLowerCase());
  return byName ? byName.campaign_id : null;
}
