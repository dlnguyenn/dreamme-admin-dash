/**
 * Value per trial by source: weekly trial-start cohorts from rc_events, split
 * by the onboarding answer (user_sources), with what each trial is worth.
 * PURE: no env, no fetch. value-per-trial-data.ts assembles the inputs.
 *
 * The question it answers (vault: wiki/revenue-100k-question.md, Decision):
 * what can each channel pay for an extra trial? A trial's projected 12-month
 * net revenue is that channel's break-even cost per trial.
 *
 * Method, pinned by tests/value-per-trial.test.ts:
 *  - A cohort is the Monday-start US/Eastern week of the trial start
 *    (INITIAL_PURCHASE, period_type TRIAL, production).
 *  - Revenue is gross price_usd of subscription and consumable charges
 *    (RENEWAL, INITIAL_PURCHASE and NON_RENEWING_PURCHASE with period_type
 *    NORMAL), matched to the trial by app_user_id. Refunds are not deducted.
 *    This reproduces the vault's rc_events 30-day read (Sep cohort $14.40 vs
 *    the vault's $14.41).
 *  - "7-day" revenue counts charges within 8 days of the trial start. The
 *    7-day trial converts at 7.0-7.5 days for 92% of App Store trials
 *    (Aug-Oct), so an exact 7.0-day cut would miss nearly every conversion.
 *  - A payer is a trial whose first subscription charge lands within 14 days
 *    (98% of conversions do). Its plan is that charge's product.
 *  - Projected 12-month gross = first charge x payments in 12 months by plan:
 *    monthly 3.4 (RC all-store retention curve), quarterly 2, yearly 1. Net is
 *    gross x 0.84 (Apple's real 15%, ~1% tax). Consumables are left out.
 *  - A metric is shown for a cohort only once every trial in it has had the
 *    full window ("mature"); younger cohorts would read low.
 */
import { addDays, easternDate, weekStart } from "./dates";
import { NET_FACTOR, sourceGroup, type SourceGroup } from "./sources";

export type Plan = "yearly" | "yearly_special" | "quarterly" | "monthly" | "consumable" | "unknown";
export type CohortGroup = SourceGroup | "unmatched";

/** Payments a new payer makes in their first 12 months, by plan (vault). */
export const PAYMENTS_IN_12M: Record<Plan, number> = {
  yearly: 1,
  yearly_special: 1,
  quarterly: 2,
  monthly: 3.4,
  consumable: 0,
  unknown: 1,
};

export const WINDOWS = { d7: 8, d30: 30, payer: 14 } as const;

/** Product id first; the billing period (days) decides the Stripe ids. */
export function planOf(productId: string | null | undefined, periodDays?: number | null): Plan {
  const p = (productId ?? "").toLowerCase();
  if (p.includes("pearls")) return "consumable";
  if (p.includes("special")) return "yearly_special";
  if (p.includes("yearly") || p.includes("annual")) return "yearly";
  if (p.includes("quarter")) return "quarterly";
  if (p.includes("month")) return "monthly";
  if (periodDays != null && Number.isFinite(periodDays)) {
    if (periodDays >= 300) return "yearly";
    if (periodDays >= 80 && periodDays <= 100) return "quarterly";
    if (periodDays >= 25 && periodDays <= 35) return "monthly";
  }
  return "unknown";
}

export const isYearly = (p: Plan) => p === "yearly" || p === "yearly_special";

export interface TrialStart {
  /** original_transaction_id: one per trial. */
  otx: string;
  userId: string | null;
  at: string; // ISO instant
  store: string | null;
}

export interface Charge {
  userId: string | null;
  otx: string | null;
  at: string;
  priceUsd: number;
  productId: string | null;
  /** expiration_at minus event_at, in days; null for consumables. */
  periodDays: number | null;
}

export interface Cohort {
  week: string; // Monday, YYYY-MM-DD
  group: CohortGroup;
  trials: number;
  payers: number;
  yearlyPayers: number;
  rev7: number;
  rev30: number;
  /** Sum over payers of first charge x PAYMENTS_IN_12M[plan]. */
  proj12Gross: number;
  /** The week is over (every trial in it has started). */
  complete: boolean;
  payersMature: boolean;
  d7Mature: boolean;
  d30Mature: boolean;
}

const DAY_MS = 86_400_000;

/** A window is mature when the week's last trial has had `days` full days by `today`. */
function matureFor(week: string, days: number, today: string): boolean {
  return addDays(week, 6 + days) < today;
}

/**
 * Build the cohort grid. `sources` maps app_user_id to referral_source
 * (null = answered nothing); a trial whose user is missing from it is
 * "unmatched" (anonymous RC ids, deleted accounts).
 */
export function buildCohorts(
  trials: TrialStart[],
  charges: Charge[],
  sources: Map<string, string | null>,
  today: string,
): Cohort[] {
  const chargesByTrial = assignCharges(trials, charges);

  const cells = new Map<string, Cohort>();
  for (const t of trials) {
    const week = weekStart(easternDate(t.at));
    const group: CohortGroup = t.userId && sources.has(t.userId) ? sourceGroup(sources.get(t.userId)) : "unmatched";
    const key = `${week}|${group}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        week,
        group,
        trials: 0,
        payers: 0,
        yearlyPayers: 0,
        rev7: 0,
        rev30: 0,
        proj12Gross: 0,
        complete: addDays(week, 6) < today,
        payersMature: matureFor(week, WINDOWS.payer, today),
        d7Mature: matureFor(week, WINDOWS.d7, today),
        d30Mature: matureFor(week, WINDOWS.d30, today),
      };
      cells.set(key, cell);
    }
    cell.trials++;
    const r = trialRevenue(t, chargesByTrial.get(t.otx) ?? []);
    cell.rev7 += r.rev7;
    cell.rev30 += r.rev30;
    if (r.first) {
      cell.payers++;
      if (isYearly(r.first.plan)) cell.yearlyPayers++;
      cell.proj12Gross += r.first.price * PAYMENTS_IN_12M[r.first.plan];
    }
  }
  return [...cells.values()].sort((a, b) => a.week.localeCompare(b.week) || a.group.localeCompare(b.group));
}

/** One trial's charges summed over the windows, and its first subscription charge (the conversion). */
export function trialRevenue(t: TrialStart, charges: Charge[]): { rev7: number; rev30: number; first: { plan: Plan; price: number } | null } {
  const start = Date.parse(t.at);
  let rev7 = 0;
  let rev30 = 0;
  let first: { plan: Plan; price: number } | null = null;
  for (const c of charges.slice().sort((a, b) => a.at.localeCompare(b.at))) {
    const age = (Date.parse(c.at) - start) / DAY_MS;
    if (age < WINDOWS.d7) rev7 += c.priceUsd;
    if (age < WINDOWS.d30) rev30 += c.priceUsd;
    const plan = planOf(c.productId, c.periodDays);
    if (!first && plan !== "consumable" && c.priceUsd > 0 && age < WINDOWS.payer) first = { plan, price: c.priceUsd };
  }
  return { rev7, rev30, first };
}

/**
 * Each charge belongs to the user's latest trial at or before it, so a user
 * with two trials is never counted twice. Charges with no user fall back to
 * the trial with the same original_transaction_id.
 */
export function assignCharges(trials: TrialStart[], charges: Charge[]): Map<string, Charge[]> {
  const trialsByUser = new Map<string, TrialStart[]>();
  for (const t of trials) {
    if (!t.userId) continue;
    const list = trialsByUser.get(t.userId) ?? [];
    list.push(t);
    trialsByUser.set(t.userId, list);
  }
  for (const list of trialsByUser.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  const trialByOtx = new Map(trials.map((t) => [t.otx, t]));

  const chargesByTrial = new Map<string, Charge[]>();
  for (const c of charges) {
    let owner: TrialStart | undefined;
    const list = c.userId ? trialsByUser.get(c.userId) : undefined;
    if (list) {
      for (const t of list) {
        if (t.at <= c.at) owner = t;
        else break;
      }
    } else if (c.otx) {
      const t = trialByOtx.get(c.otx);
      if (t && t.at <= c.at) owner = t;
    }
    if (!owner) continue;
    const arr = chargesByTrial.get(owner.otx) ?? [];
    arr.push(c);
    chargesByTrial.set(owner.otx, arr);
  }
  return chargesByTrial;
}

export interface GroupSummary {
  trials: number;
  /** Payer metrics and the 12-month projection share the payer-mature weeks. */
  payerWeeks: string[];
  payerTrials: number;
  payerRate: number | null;
  /** Yearly (incl. yearly special) share of payers. */
  yearlyShare: number | null;
  rev7Weeks: string[];
  rev7PerTrial: number | null;
  rev30Weeks: string[];
  rev30PerTrial: number | null;
  proj12GrossPerTrial: number | null;
  /** Projected 12-month net per trial = the channel's break-even cost per extra trial. */
  net12PerTrial: number | null;
}

export type SummaryKey = SourceGroup | "nonMeta" | "all";

function sum(cells: Cohort[], f: (c: Cohort) => number) {
  return cells.reduce((s, c) => s + f(c), 0);
}

/**
 * Summary per group. With `lastN`, each metric reads that group's latest N
 * weeks mature for it (so 30-day revenue reads older weeks than the payer
 * rate). With `from`/`to`, every metric reads the mature weeks in that span.
 */
export function summarize(
  cohorts: Cohort[],
  opts: { lastN?: number; from?: string; to?: string },
): Record<SummaryKey, GroupSummary> {
  const groups: Record<SummaryKey, (g: CohortGroup) => boolean> = {
    meta: (g) => g === "meta",
    tiktok: (g) => g === "tiktok",
    other: (g) => g === "other",
    nonMeta: (g) => g === "tiktok" || g === "other",
    all: () => true,
  };
  const pick = (cells: Cohort[], mature: (c: Cohort) => boolean) => {
    const inSpan = cells.filter((c) => (!opts.from || c.week >= opts.from) && (!opts.to || c.week <= opts.to) && mature(c));
    const weeks = [...new Set(inSpan.map((c) => c.week))].sort();
    const keep = opts.lastN != null ? new Set(weeks.slice(-opts.lastN)) : new Set(weeks);
    return { weeks: [...keep].sort(), cells: inSpan.filter((c) => keep.has(c.week)) };
  };

  const out = {} as Record<SummaryKey, GroupSummary>;
  for (const key of Object.keys(groups) as SummaryKey[]) {
    const mine = cohorts.filter((c) => groups[key](c.group));
    const p = pick(mine, (c) => c.payersMature);
    const r7 = pick(mine, (c) => c.d7Mature);
    const r30 = pick(mine, (c) => c.d30Mature);
    const payerTrials = sum(p.cells, (c) => c.trials);
    const payers = sum(p.cells, (c) => c.payers);
    const r7Trials = sum(r7.cells, (c) => c.trials);
    const r30Trials = sum(r30.cells, (c) => c.trials);
    const proj = payerTrials ? sum(p.cells, (c) => c.proj12Gross) / payerTrials : null;
    out[key] = {
      trials: sum(mine.filter((c) => (!opts.from || c.week >= opts.from) && (!opts.to || c.week <= opts.to)), (c) => c.trials),
      payerWeeks: p.weeks,
      payerTrials,
      payerRate: payerTrials ? payers / payerTrials : null,
      yearlyShare: payers ? sum(p.cells, (c) => c.yearlyPayers) / payers : null,
      rev7Weeks: r7.weeks,
      rev7PerTrial: r7Trials ? sum(r7.cells, (c) => c.rev7) / r7Trials : null,
      rev30Weeks: r30.weeks,
      rev30PerTrial: r30Trials ? sum(r30.cells, (c) => c.rev30) / r30Trials : null,
      proj12GrossPerTrial: proj,
      net12PerTrial: proj == null ? null : proj * NET_FACTOR,
    };
  }
  return out;
}

/** Weekly projected 12-month net per trial for one group, payer-mature weeks only. */
export function net12Series(cohorts: Cohort[], group: SourceGroup): { week: string; value: number | null; trials: number }[] {
  return cohorts
    .filter((c) => c.group === group)
    .map((c) => ({
      week: c.week,
      trials: c.trials,
      value: c.payersMature && c.trials > 0 ? (c.proj12Gross / c.trials) * NET_FACTOR : null,
    }));
}
