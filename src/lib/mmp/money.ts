/**
 * Money per Meta ad, from Singular (view public.mmp_ad_money, migration 0116).
 *
 * RevenueCat sends purchases, trial conversions and renewals to Singular with
 * gross revenue (since 2026-11-05), and Singular ties them to the ad that
 * brought the install. Only installs from 2026-10-30 on are counted: their
 * trials converted after the integration went live (see migration 0116).
 *
 * "Mature" = installs old enough that the window has closed (14 days for
 * payers and revenue, 30 days for the longer revenue read), so the numbers
 * won't move again. Rates are only shown from mature installs with enough
 * trials to mean something; raw counts are always shown.
 */
import { toNum } from "./parity";

export interface MmpAdMoneyRow {
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  /** First install day counted (trials converting after RevenueCat -> Singular went live). */
  floor_date: string | null;
  /** Days in the payer/revenue window (Singular's conversion period). */
  conv_days: number;
  spend_since: number;
  trials_since: number;
  paid_since: number;
  revenue_since: number;
  spend_mature: number;
  trials_mature: number;
  paid_mature: number;
  revenue_mature: number;
  spend_mature_30d: number;
  trials_mature_30d: number;
  revenue_mature_30d: number;
}

export function toAdMoneyRow(raw: Record<string, unknown>): MmpAdMoneyRow {
  const str = (v: unknown) => (v == null || v === "" ? null : String(v));
  return {
    campaign_id: String(raw.campaign_id ?? ""),
    campaign_name: str(raw.campaign_name),
    adset_id: str(raw.adset_id),
    adset_name: str(raw.adset_name),
    ad_id: str(raw.ad_id),
    ad_name: str(raw.ad_name),
    floor_date: str(raw.floor_date)?.slice(0, 10) ?? null,
    conv_days: toNum(raw.conv_days) || 14,
    spend_since: toNum(raw.spend_since),
    trials_since: toNum(raw.trials_since),
    paid_since: toNum(raw.paid_since),
    revenue_since: toNum(raw.revenue_since),
    spend_mature: toNum(raw.spend_mature),
    trials_mature: toNum(raw.trials_mature),
    paid_mature: toNum(raw.paid_mature),
    revenue_mature: toNum(raw.revenue_mature),
    spend_mature_30d: toNum(raw.spend_mature_30d),
    trials_mature_30d: toNum(raw.trials_mature_30d),
    revenue_mature_30d: toNum(raw.revenue_mature_30d),
  };
}

/** Below this many mature trials, cost per payer and return are noise. */
export const MIN_TRIALS_FOR_MONEY = 20;

/** The numbers one table row shows, for an ad or an ad set total. */
export interface MoneyLine {
  spend: number;
  trials: number;
  payers: number;
  revenue: number;
  /** Spend / payers; null when too few trials or no payers. */
  costPerPayer: number | null;
  /** Revenue / spend over the payer window; null when too few trials or no spend. */
  returnOnSpend: number | null;
  /** Revenue / spend over 30 days; null until enough installs are 30 days old. */
  returnOnSpend30d: number | null;
  /** True when the row is too thin to read (counts shown, rates hidden). */
  thin: boolean;
}

type MoneyFields = Pick<
  MmpAdMoneyRow,
  "spend_mature" | "trials_mature" | "paid_mature" | "revenue_mature" | "spend_mature_30d" | "trials_mature_30d" | "revenue_mature_30d"
>;

export function moneyLine(r: MoneyFields, min = MIN_TRIALS_FOR_MONEY): MoneyLine {
  const enough = r.trials_mature >= min;
  const enough30 = r.trials_mature_30d >= min;
  return {
    spend: r.spend_mature,
    trials: r.trials_mature,
    payers: r.paid_mature,
    revenue: r.revenue_mature,
    costPerPayer: enough && r.paid_mature > 0 && r.spend_mature > 0 ? r.spend_mature / r.paid_mature : null,
    returnOnSpend: enough && r.spend_mature > 0 ? r.revenue_mature / r.spend_mature : null,
    returnOnSpend30d: enough30 && r.spend_mature_30d > 0 ? r.revenue_mature_30d / r.spend_mature_30d : null,
    thin: !enough,
  };
}

export interface MoneyGroup extends MoneyFields {
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ads: MmpAdMoneyRow[];
}

export interface MoneySummary {
  groups: MoneyGroup[];
  /** Installs since the floor, mature or not: what has come in so far. */
  sinceTotals: { spend: number; trials: number; payers: number; revenue: number };
  /** Mature totals across every ad. */
  matureTotals: MoneyFields;
  floorDate: string | null;
  convDays: number;
  /** First day the payer window closes for the floor's installs (floor + conv_days). */
  firstMatureDay: string | null;
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const zero = (): MoneyFields => ({
  spend_mature: 0,
  trials_mature: 0,
  paid_mature: 0,
  revenue_mature: 0,
  spend_mature_30d: 0,
  trials_mature_30d: 0,
  revenue_mature_30d: 0,
});

const add = (into: MoneyFields, r: MoneyFields) => {
  into.spend_mature += r.spend_mature;
  into.trials_mature += r.trials_mature;
  into.paid_mature += r.paid_mature;
  into.revenue_mature += r.revenue_mature;
  into.spend_mature_30d += r.spend_mature_30d;
  into.trials_mature_30d += r.trials_mature_30d;
  into.revenue_mature_30d += r.revenue_mature_30d;
};

/**
 * Ads grouped under their ad set. Only rows with mature trials are listed
 * (the rest have nothing final to show yet); ad sets and ads are ordered by
 * mature spend.
 */
export function summarizeMoney(rows: MmpAdMoneyRow[]): MoneySummary {
  const groups = new Map<string, MoneyGroup>();
  const matureTotals = zero();
  const sinceTotals = { spend: 0, trials: 0, payers: 0, revenue: 0 };
  for (const r of rows) {
    sinceTotals.spend += r.spend_since;
    sinceTotals.trials += r.trials_since;
    sinceTotals.payers += r.paid_since;
    sinceTotals.revenue += r.revenue_since;
    add(matureTotals, r);
    if (r.trials_mature <= 0 && r.spend_mature <= 0) continue;
    const key = `${r.campaign_id}\u0001${r.adset_id ?? ""}`;
    const g = groups.get(key) ?? { ...zero(), campaign_name: r.campaign_name, adset_id: r.adset_id, adset_name: r.adset_name, ads: [] };
    g.adset_name = g.adset_name ?? r.adset_name;
    add(g, r);
    if (r.trials_mature > 0) g.ads.push(r);
    groups.set(key, g);
  }
  const shown = [...groups.values()].filter((g) => g.trials_mature > 0);
  for (const g of shown) g.ads.sort((a, b) => b.spend_mature - a.spend_mature || b.trials_mature - a.trials_mature);
  shown.sort((a, b) => b.spend_mature - a.spend_mature || b.trials_mature - a.trials_mature);
  const floorDate = rows.find((r) => r.floor_date)?.floor_date ?? null;
  const convDays = rows[0]?.conv_days ?? 14;
  return {
    groups: shown,
    sinceTotals,
    matureTotals,
    floorDate,
    convDays,
    firstMatureDay: floorDate ? addDays(floorDate, convDays) : null,
  };
}
