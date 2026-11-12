/**
 * Reduce RevenueCat's experiment-results payload to the four numbers a person
 * actually reads. Pure, so it can be tested against a saved payload.
 *
 * The payload's shape is awkward on purpose: each section carries its own
 * `metrics` and `segments` lists, and every number in `values` points at them
 * by index. So a metric must be found by NAME inside its section and then
 * matched on that section's indexes — an index from one section means
 * something else in the next.
 *
 * RevenueCat calls the control arm "a" (`control_variant`); we read the first
 * non-control arm as "b". Percentages arrive as whole numbers in `value`
 * (22.05 = 22.05%) while credible intervals are fractions (0.22), which is
 * why only `value` is used here.
 */
import type { RcReadout } from "@/lib/experiment-health";

export interface RcResultsPayload {
  sections?: {
    section?: string;
    metrics?: { name?: string }[];
    segments?: { id?: string; is_total?: boolean }[];
    values?: {
      metric?: number;
      segment?: number;
      variant?: string;
      value?: number | null;
    }[];
  }[];
  control_variant?: string;
  statistics?: {
    metric_name?: string;
    variants?: {
      name?: string;
      chance_to_win?: number | null;
      chance_to_win_status?: string;
    }[];
  }[];
}

/** The total-row value of one named metric, per arm. */
function metricByName(
  payload: RcResultsPayload,
  metricName: string,
  control: string,
  treatment: string,
): { a: number | null; b: number | null } {
  for (const section of payload.sections ?? []) {
    const mi = (section.metrics ?? []).findIndex((m) => m.name === metricName);
    if (mi < 0) continue;
    const si = (section.segments ?? []).findIndex((s) => s.is_total === true);
    const total = si < 0 ? 0 : si;
    let a: number | null = null;
    let b: number | null = null;
    for (const v of section.values ?? []) {
      if (v.metric !== mi || v.segment !== total) continue;
      if (v.variant === control) a = v.value ?? null;
      else if (v.variant === treatment) b = v.value ?? null;
    }
    return { a, b };
  }
  return { a: null, b: null };
}

function armNames(payload: RcResultsPayload): { control: string; treatment: string } {
  const control = payload.control_variant ?? "a";
  const seen = new Set<string>();
  for (const section of payload.sections ?? []) {
    for (const v of section.values ?? []) if (v.variant) seen.add(v.variant);
  }
  const treatment = [...seen].sort().find((n) => n !== control) ?? "b";
  return { control, treatment };
}

function changePct(a: number | null, b: number | null): number | null {
  if (a == null || b == null || a === 0) return null;
  return ((b - a) / a) * 100;
}

/**
 * RevenueCat's own verdict on the trial-start rate. `chance_to_win` sits on
 * the treatment arm; "insufficient_data" means it is honestly too early,
 * which is different from the metric being missing.
 */
function chance(payload: RcResultsPayload, treatment: string): Pick<RcReadout, "chanceToWin" | "chanceToWinStatus"> {
  const stat = (payload.statistics ?? []).find((s) => s.metric_name === "initial_conversion_rate");
  const arm = (stat?.variants ?? []).find((v) => v.name === treatment);
  if (!arm) return { chanceToWin: null, chanceToWinStatus: "unavailable" };
  const status = arm.chance_to_win_status === "ok" ? "ok" : arm.chance_to_win_status === "insufficient_data" ? "insufficient_data" : "unavailable";
  return { chanceToWin: status === "ok" ? arm.chance_to_win ?? null : null, chanceToWinStatus: status };
}

export function reduceResults(payload: RcResultsPayload): RcReadout {
  const { control, treatment } = armNames(payload);
  const customers = metricByName(payload, "Customers", control, treatment);
  const trialsStarted = metricByName(payload, "Trials started", control, treatment);
  const rate = metricByName(payload, "Initial conversion rate", control, treatment);
  const ltv = metricByName(payload, "Realized LTV per customer", control, treatment);
  return {
    customers,
    trialsStarted,
    startRate: { ...rate, changePct: changePct(rate.a, rate.b) },
    ltvPerCustomer: ltv,
    ...chance(payload, treatment),
  };
}
