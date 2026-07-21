/**
 * Pricing-experiment tracking: shared types + the transform that turns
 * RevenueCat's trial_conversion_rate chart (weekly, segmented by
 * product_duration) into per-week / per-duration rows the dashboard renders.
 *
 * Consumed by /api/pricing-experiment (server) and PricingExperiments.tsx
 * (client). Experiment definitions live in the component, next to the
 * EXPERIMENTS precedent in MarketingEfficiency.
 */
import type { ChartResponse } from "@/lib/vendors/revenuecat";

export interface DurationStats {
  starts: number;
  conversions: number;
  expirations: number;
  /** RC occasionally reports small negative pendings — clamped to 0. */
  pending: number;
  /** Percent (0–100), null until RC reports it. */
  cvr: number | null;
}

export interface PricingWeek {
  /** ISO date of the bucket start (RC weeks start Monday, UTC). */
  weekStart: string;
  /** RC's incomplete flag — partial first bucket or the in-progress week. */
  incomplete: boolean;
  total: DurationStats;
  /** Keyed by RC duration label: P1M, P3M, P1Y. */
  byDuration: Record<string, DurationStats>;
}

export interface PricingExperimentResponse {
  fetchedAt: string;
  weeks: PricingWeek[];
}

function emptyStats(): DurationStats {
  return { starts: 0, conversions: 0, expirations: 0, pending: 0, cvr: null };
}

export function transformTrialChart(chart: ChartResponse): PricingWeek[] {
  const measureNames = chart.measures.map((m) => m.display_name);
  const segments = chart.segments ?? [];
  const byWeek = new Map<number, PricingWeek>();

  for (const v of chart.values) {
    let week = byWeek.get(v.cohort);
    if (!week) {
      week = {
        weekStart: new Date(v.cohort * 1000).toISOString().slice(0, 10),
        incomplete: false,
        total: emptyStats(),
        byDuration: {},
      };
      byWeek.set(v.cohort, week);
    }
    week.incomplete = week.incomplete || v.incomplete;

    const seg = v.segment != null ? segments[v.segment] : undefined;
    const isTotal = v.segment == null || !!seg?.is_total;
    let stats: DurationStats;
    if (isTotal) {
      stats = week.total;
    } else {
      const key = seg?.display_name ?? `segment_${v.segment}`;
      stats = week.byDuration[key] ?? (week.byDuration[key] = emptyStats());
    }

    const value = Number(v.value) || 0;
    switch (measureNames[v.measure]) {
      case "Trial Starts":
        stats.starts = value;
        break;
      case "Conversions":
        stats.conversions = value;
        break;
      case "Expirations":
        stats.expirations = value;
        break;
      case "Pending":
        stats.pending = Math.max(0, value);
        break;
      case "Conversion Rate":
        stats.cvr = value;
        break;
    }
  }

  return [...byWeek.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, week]) => week);
}

/**
 * A week's CVR is only readable once its 7-day trials have resolved —
 * treat it as mature when pending trials are under 10% of starts.
 */
export function isMature(stats: DurationStats): boolean {
  if (stats.starts === 0) return false;
  return stats.pending <= Math.max(1, stats.starts * 0.1);
}
