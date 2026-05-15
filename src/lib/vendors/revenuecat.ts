/**
 * RevenueCat v2 API client (bare fetch, no SDK).
 *
 * Mirrors the retry/backoff style of meta-ads.ts. Reads env lazily inside
 * functions so loadEnvConfig() in CLI scripts has a chance to run.
 *
 * Auth: bearer with a v2 secret API key (read scope is sufficient).
 */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const BASE_URL = "https://api.revenuecat.com/v2";

function getApiKey(): string {
  return process.env.REVENUECAT_API_KEY ?? "";
}
function getProjectId(): string {
  return process.env.REVENUECAT_PROJECT_ID ?? "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function revenueCatConfigured(): boolean {
  return !!getApiKey() && !!getProjectId();
}

async function rcFetchJson<T>(
  path: string,
  query: Record<string, string | undefined>,
  maxRetries: number,
): Promise<T> {
  const KEY = getApiKey();
  if (!KEY) throw new Error("REVENUECAT_API_KEY not set");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") qs.set(k, v);
  }
  const url = `${BASE_URL}${path}${qs.toString() ? `?${qs.toString()}` : ""}`;
  const headers = { Authorization: `Bearer ${KEY}`, accept: "application/json" };
  let attempt = 0;
  while (true) {
    const res = await fetch(url, { headers, cache: "no-store" });
    if (res.ok) return (await res.json()) as T;
    const text = await res.text();
    if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
      throw new Error(
        `RevenueCat API error: ${res.status} ${text.slice(0, 200)}`,
      );
    }
    const retryAfter = res.headers.get("retry-after");
    const retryMs = retryAfter
      ? Math.max(0, Math.min(60_000, Number(retryAfter) * 1000))
      : 0;
    const backoff = Math.min(32_000, 1000 * Math.pow(2, attempt));
    await sleep(retryMs || backoff + Math.floor(Math.random() * 250));
    attempt++;
  }
}

export interface RcOverview {
  active_trials: number;
  active_subscriptions: number;
  mrr: number;
  revenue: number;
  new_customers: number;
  active_users: number;
}

interface RcOverviewResponse {
  metrics?: Array<{ id: string; value: number }>;
}

export async function fetchOverview(maxRetries = 4): Promise<RcOverview> {
  const projectId = getProjectId();
  if (!projectId) throw new Error("REVENUECAT_PROJECT_ID not set");
  const body = await rcFetchJson<RcOverviewResponse>(
    `/projects/${projectId}/metrics/overview`,
    {},
    maxRetries,
  );
  const map = new Map<string, number>();
  for (const m of body.metrics ?? []) map.set(m.id, Number(m.value) || 0);
  return {
    active_trials: map.get("active_trials") ?? 0,
    active_subscriptions: map.get("active_subscriptions") ?? 0,
    mrr: map.get("mrr") ?? 0,
    revenue: map.get("revenue") ?? 0,
    new_customers: map.get("new_customers") ?? 0,
    active_users: map.get("active_users") ?? 0,
  };
}

export type ChartName =
  | "trials_new"
  | "trial_conversion_rate"
  | "revenue"
  | "ltv_per_paying_customer"
  | "mrr"
  | "actives"
  | "customers_new"
  | "churn"
  | "subscription_status";

export type Resolution = "day" | "week" | "month" | "quarter" | "year";

const RESOLUTION_ID: Record<Resolution, string> = {
  day: "0",
  week: "1",
  month: "2",
  quarter: "3",
  year: "4",
};

export interface ChartValue {
  cohort: number; // unix seconds at bucket start
  value: number;
  measure: number; // index into measures[]
  incomplete: boolean;
  segment?: number; // index into segments[]; only present when chart was segmented
}

export interface ChartSegment {
  display_name: string;
  chartable: boolean;
  tabulable: boolean;
  is_total?: boolean;
}

export interface ChartMeasure {
  display_name: string;
  unit: string;
  decimal_precision: number;
}

export interface ChartResponse {
  start_date: number;
  end_date: number;
  resolution: string;
  values: ChartValue[];
  segments: ChartSegment[] | null;
  measures: ChartMeasure[];
  summary?: Record<string, unknown>;
}

/**
 * Fetch a chart's time series. Pass `segment` to break out by a dimension
 * (e.g. "attribution_ad"). Today the per-ad segment returns one row labeled
 * "No Attribution" for everything; that's the bug the iOS handoff doc is
 * meant to fix.
 */
export async function fetchChart(params: {
  chartName: ChartName;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  resolution?: Resolution;
  segment?: string;
  selectors?: Record<string, string>;
  currency?: string;
  maxRetries?: number;
}): Promise<ChartResponse> {
  const projectId = getProjectId();
  if (!projectId) throw new Error("REVENUECAT_PROJECT_ID not set");
  return rcFetchJson<ChartResponse>(
    `/projects/${projectId}/metrics/charts/${params.chartName}`,
    {
      start_date: params.startDate,
      end_date: params.endDate,
      resolution: params.resolution ? RESOLUTION_ID[params.resolution] : "0",
      segment: params.segment,
      currency: params.currency,
      selectors: params.selectors ? JSON.stringify(params.selectors) : undefined,
    },
    params.maxRetries ?? 4,
  );
}

/**
 * Convenience: turn a single-measure chart's `values` into a Map keyed by
 * YYYY-MM-DD (UTC). For multi-measure charts, pass `measureIndex` to pick
 * the right measure.
 */
export function valuesByDate(
  chart: ChartResponse,
  measureIndex = 0,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const v of chart.values) {
    if (v.measure !== measureIndex) continue;
    const d = new Date(v.cohort * 1000).toISOString().slice(0, 10);
    out.set(d, Number(v.value) || 0);
  }
  return out;
}
