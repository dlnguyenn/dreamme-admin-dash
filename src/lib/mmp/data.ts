/**
 * Server-only reads for the MMP tab: the one-row snapshot (plus Singular's
 * paid-conversion totals, migration 0100), the per-campaign and per-ad
 * comparisons (0098-0100), trial-to-paid by age, the weekly ad set rows and
 * App Store downloads by source (0101). All views are service-role only.
 * Meta's live age mix and ad set settings are fetched separately (meta-live.ts)
 * so a Meta outage never blanks the tab.
 */
import { sbGet } from "@/lib/revenue-plan/db";
import {
  toAdRow,
  toCampaignRow,
  toSnapshot,
  type MmpAdRow,
  type MmpCampaignRow,
  type MmpSnapshot,
} from "./parity";
import {
  toAdSetWeek,
  toAgeRateRow,
  toAscSourceRow,
  type AdSetWeek,
  type AgeRateRow,
  type AscSourceRow,
} from "./payers";
import { toAdMoneyRow, type MmpAdMoneyRow } from "./money";

export interface MmpData {
  snapshot: MmpSnapshot;
  campaigns: MmpCampaignRow[];
  ads: MmpAdRow[];
  ageRates: AgeRateRow[];
  adsetWeek: AdSetWeek[];
  asc: AscSourceRow[];
  /** Money per ad (0116). Empty, with the reason, if the view can't be read. */
  money: MmpAdMoneyRow[];
  moneyError?: string;
}

export async function fetchMmp(): Promise<MmpData> {
  const [snap, paid, campaigns, ads, ages, weeks, asc] = await Promise.all([
    sbGet<Record<string, unknown>[]>("internal", "mmp_snapshot_mv?select=*&limit=1"),
    sbGet<Record<string, unknown>[]>("internal", "mmp_singular_paid?select=*&limit=1"),
    sbGet<Record<string, unknown>[]>("internal", "mmp_campaign_attribution?select=*"),
    sbGet<Record<string, unknown>[]>("internal", "mmp_ad_attribution?select=*"),
    sbGet<Record<string, unknown>[]>("internal", "trial_to_paid_by_age?select=*"),
    sbGet<Record<string, unknown>[]>("internal", "mmp_adset_week?select=*"),
    sbGet<Record<string, unknown>[]>("internal", "mmp_asc_sources?select=*"),
  ]);
  // Read on its own so a missing or failing view never blanks the rest of the tab.
  let money: MmpAdMoneyRow[] = [];
  let moneyError: string | undefined;
  try {
    money = (await sbGet<Record<string, unknown>[]>("internal", "mmp_ad_money?select=*")).map(toAdMoneyRow);
  } catch (e) {
    moneyError = (e as Error).message;
  }
  if (!snap.length) throw new Error("mmp_snapshot returned no row");
  return {
    snapshot: toSnapshot({ ...snap[0], ...(paid[0] ?? {}) }),
    campaigns: campaigns.map(toCampaignRow),
    ads: ads.map(toAdRow),
    ageRates: ages.map(toAgeRateRow),
    adsetWeek: weeks.map(toAdSetWeek),
    asc: asc.map(toAscSourceRow),
    money,
    ...(moneyError ? { moneyError } : {}),
  };
}
