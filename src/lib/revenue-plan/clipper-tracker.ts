/**
 * Clipper campaign tracker: what each week of pay-per-view clipping cost and
 * how many extra trials it bought. PURE. clipper-tracker-data.ts assembles
 * the weeks; spend is entered by hand (Content Rewards / Whop has no API).
 *
 * Vault (wiki/revenue-100k-question.md, lever 1): July's peak came from the
 * Content Rewards clipper campaign at ~$8-15 per extra trial. The relaunch
 * runs in $3k tranches, judged weekly:
 *  - pause if an extra trial costs more than $18 two weeks running;
 *  - double the tranche at $15 or less.
 *
 * "Extra" is measured against a baseline of the six complete weeks before the
 * first week with clipper spend (before any spend: the latest six weeks).
 * The stop rule reads extra NON-META trials, because clipper viewers also
 * answer "App Store" or "friend/family" (the vault's $8-15 used the same
 * basis). Extra TikTok-sourced trials alone give the strict upper bound on
 * cost, shown alongside. Seasonality (January) inflates any fixed baseline;
 * read the Meta-sourced column as the check.
 * Pinned by tests/clipper-tracker.test.ts.
 */
import { addDays } from "./dates";

export const CLIPPER_RULES = {
  pauseAbove: 18,
  doubleAtOrBelow: 15,
  trancheUsd: 3000,
  baselineWeeks: 6,
  /** Vault: TikTok-sourced onboardings ran ~240/week from late August on. */
  vaultTiktokOnboardingsPerWeek: 240,
} as const;

export interface ClipperWeekEntry {
  weekStart: string; // Monday
  viewsBought: number | null;
  payoutsUsd: number;
  feesUsd: number;
  tranche: string | null;
  note: string | null;
}

export interface WeekCounts {
  week: string; // Monday, US/Eastern
  complete: boolean;
  onboardings: number;
  tiktokOnboardings: number;
  trials: number;
  metaTrials: number;
  tiktokTrials: number;
  /** TikTok + other organic. */
  nonMetaTrials: number;
}

export interface Baseline {
  from: string;
  to: string;
  weeks: number;
  tiktokOnboardings: number;
  tiktokTrials: number;
  nonMetaTrials: number;
  metaTrials: number;
}

export type StopStatus = "no_spend" | "pending" | "no_lift" | "double" | "hold" | "over" | "pause";

export interface TrackerWeek extends WeekCounts {
  entry: ClipperWeekEntry | null;
  /** Payouts + fees. */
  spend: number;
  extraTiktokOnboardings: number;
  extraTiktokTrials: number;
  extraNonMetaTrials: number;
  /** Stop-rule basis: spend / extra non-Meta trials. Null without spend or lift. */
  costPerExtraTrial: number | null;
  /** Strict bound: spend / extra TikTok-sourced trials. */
  costPerExtraTiktokTrial: number | null;
  costPer1kViews: number | null;
  status: StopStatus;
}

export const spendOf = (e: ClipperWeekEntry | null | undefined) => (e ? (e.payoutsUsd || 0) + (e.feesUsd || 0) : 0);

/** Six complete weeks before the first week with spend; before any spend, the latest six complete weeks. */
export function baselineSpan(counts: WeekCounts[], entries: ClipperWeekEntry[]): { from: string; to: string } | null {
  const firstSpend = entries
    .filter((e) => spendOf(e) > 0)
    .map((e) => e.weekStart)
    .sort()[0];
  const complete = counts.filter((c) => c.complete && (!firstSpend || c.week < firstSpend)).map((c) => c.week);
  if (!complete.length) return null;
  const weeks = complete.slice(-CLIPPER_RULES.baselineWeeks);
  return { from: weeks[0], to: addDays(weeks[weeks.length - 1], 6) };
}

export function baselineFrom(counts: WeekCounts[], span: { from: string; to: string }): Baseline {
  const rows = counts.filter((c) => c.complete && c.week >= span.from && c.week <= span.to);
  const avg = (f: (c: WeekCounts) => number) => (rows.length ? rows.reduce((s, c) => s + f(c), 0) / rows.length : 0);
  return {
    ...span,
    weeks: rows.length,
    tiktokOnboardings: avg((c) => c.tiktokOnboardings),
    tiktokTrials: avg((c) => c.tiktokTrials),
    nonMetaTrials: avg((c) => c.nonMetaTrials),
    metaTrials: avg((c) => c.metaTrials),
  };
}

export function trackerWeeks(counts: WeekCounts[], entries: ClipperWeekEntry[], base: Baseline): TrackerWeek[] {
  const byWeek = new Map(entries.map((e) => [e.weekStart, e]));
  const out: TrackerWeek[] = [];
  let prevOverWeek: string | null = null;
  for (const c of [...counts].sort((a, b) => a.week.localeCompare(b.week))) {
    const entry = byWeek.get(c.week) ?? null;
    const spend = spendOf(entry);
    const extraNonMeta = c.nonMetaTrials - base.nonMetaTrials;
    const extraTiktok = c.tiktokTrials - base.tiktokTrials;
    const costPerExtraTrial = spend > 0 && extraNonMeta > 0 ? spend / extraNonMeta : null;
    let status: StopStatus = "no_spend";
    if (spend > 0 && !c.complete) status = "pending";
    else if (spend > 0) {
      const over = costPerExtraTrial == null || costPerExtraTrial > CLIPPER_RULES.pauseAbove;
      if (costPerExtraTrial == null) status = "no_lift";
      else if (costPerExtraTrial <= CLIPPER_RULES.doubleAtOrBelow) status = "double";
      else if (over) status = "over";
      else status = "hold";
      // Two spend weeks running over $18 (no lift counts as over) = pause.
      if (over && prevOverWeek === addDays(c.week, -7)) status = "pause";
      prevOverWeek = over ? c.week : null;
    }
    out.push({
      ...c,
      entry,
      spend,
      extraTiktokOnboardings: c.tiktokOnboardings - base.tiktokOnboardings,
      extraTiktokTrials: extraTiktok,
      extraNonMetaTrials: extraNonMeta,
      costPerExtraTrial,
      costPerExtraTiktokTrial: spend > 0 && extraTiktok > 0 ? spend / extraTiktok : null,
      costPer1kViews: spend > 0 && entry?.viewsBought ? (spend / entry.viewsBought) * 1000 : null,
      status,
    });
  }
  return out;
}

/** The decision the rule gives now: the latest complete week with spend. */
export function currentCall(weeks: TrackerWeek[]): TrackerWeek | null {
  const judged = weeks.filter((w) => w.spend > 0 && w.complete);
  return judged[judged.length - 1] ?? null;
}
