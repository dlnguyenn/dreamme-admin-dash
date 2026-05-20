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
    `/projects/${projectId}/charts/${params.chartName}`,
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

// ---------------------------------------------------------------------------
// Customer-list functions for audience building
// ---------------------------------------------------------------------------
//
// Used by scripts/refresh-meta-audiences.ts to pull a list of currently
// paying users + their email addresses, which then gets uploaded to Meta
// as a Custom Audience seed for a lookalike.
//
// v2 quirks discovered while probing:
// - Customer list endpoint does NOT honor `expand[]=active_entitlements`,
//   so we N+1: list customers, then per-customer fetch /active_entitlements
//   + /attributes.
// - `entitlements=X` filter on the customers endpoint is silently ignored.
// - `/entitlements/{id}/customers` endpoint does not exist (404).
// - Page size is capped at 100 regardless of `limit`.
// - v1 API rejects v2 secret keys.

interface ListResponse<T> {
  items: T[];
  next_page: string | null;
}

interface CustomerRow {
  id: string;
  first_seen_at: number; // unix ms
  last_seen_at: number;
  last_seen_country?: string;
  last_seen_platform?: string;
}

interface AttributeRow {
  name: string;
  value: string;
  updated_at: number;
}

interface ActiveEntitlementRow {
  id: string;
  lookup_key?: string;
  expires_at?: number | null;
  starts_at?: number;
}

// rcFetchJson above uses a query-record signature; this helper accepts a
// full URL (the cursor-based pagination from RC returns absolute next_page
// URLs that we can't decompose without losing fidelity).
async function rcGetUrl<T>(url: string, maxRetries = 4): Promise<T> {
  const KEY = getApiKey();
  if (!KEY) throw new Error("REVENUECAT_API_KEY not set");
  const headers = {
    Authorization: `Bearer ${KEY}`,
    accept: "application/json",
  };
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

/**
 * Page through customers. Stops paginating once first_seen_at falls below
 * the threshold (customers come back newest-first).
 */
export async function* iterateCustomers(params: {
  sinceMs?: number;
}): AsyncGenerator<CustomerRow, void, unknown> {
  const projectId = getProjectId();
  if (!projectId) throw new Error("REVENUECAT_PROJECT_ID not set");
  let url: string | null = `${BASE_URL}/projects/${projectId}/customers?limit=100`;
  while (url) {
    const page: ListResponse<CustomerRow> = await rcGetUrl(url);
    let stoppedEarly = false;
    for (const c of page.items) {
      if (params.sinceMs && c.first_seen_at < params.sinceMs) {
        stoppedEarly = true;
        break;
      }
      yield c;
    }
    if (stoppedEarly) return;
    url = page.next_page;
  }
}

export async function getCustomerActiveEntitlements(
  customerId: string,
): Promise<ActiveEntitlementRow[]> {
  const projectId = getProjectId();
  const r: ListResponse<ActiveEntitlementRow> = await rcGetUrl(
    `${BASE_URL}/projects/${projectId}/customers/${customerId}/active_entitlements`,
  );
  return r.items;
}

export async function getCustomerEmail(
  customerId: string,
): Promise<string | null> {
  const projectId = getProjectId();
  const r: ListResponse<AttributeRow> = await rcGetUrl(
    `${BASE_URL}/projects/${projectId}/customers/${customerId}/attributes`,
  );
  const emailAttr = r.items.find((a) => a.name === "$email");
  if (!emailAttr || !emailAttr.value) return null;
  return emailAttr.value;
}

/** Concurrent map with a fixed parallelism cap. */
async function pMap<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return out;
}

export interface PaidCustomerWithEmail {
  customerId: string;
  email: string;
  entitlement: string;
  firstSeenAt: number;
}

/**
 * Pull all customers seen in the window, check which have an active
 * entitlement, fetch their email. Excludes Apple Hide-My-Email relays
 * since those don't match in Meta.
 */
export async function fetchPaidCustomersWithEmail(params: {
  sinceMs?: number;
  concurrency?: number;
  log?: (msg: string) => void;
}): Promise<PaidCustomerWithEmail[]> {
  const concurrency = params.concurrency ?? 25;
  const log = params.log ?? ((m) => process.stderr.write(m + "\n"));

  log(
    `Listing customers${params.sinceMs ? ` since ${new Date(params.sinceMs).toISOString().slice(0, 10)}` : ""}...`,
  );
  const allCustomers: CustomerRow[] = [];
  for await (const c of iterateCustomers({ sinceMs: params.sinceMs })) {
    allCustomers.push(c);
    if (allCustomers.length % 500 === 0) {
      log(`  enumerated ${allCustomers.length} customers...`);
    }
  }
  log(`  done — ${allCustomers.length} customers in window.`);

  log(`Checking active entitlements (concurrency=${concurrency})...`);
  const entitlementResults = await pMap(
    allCustomers,
    async (c) => {
      const ents = await getCustomerActiveEntitlements(c.id);
      return { customer: c, ents };
    },
    concurrency,
  );

  const paidCustomers = entitlementResults.filter((r) => r.ents.length > 0);
  log(
    `  done — ${paidCustomers.length} of ${allCustomers.length} customers have an active entitlement.`,
  );

  log(`Fetching emails for paid customers...`);
  const withEmails = await pMap(
    paidCustomers,
    async ({ customer, ents }) => {
      const email = await getCustomerEmail(customer.id);
      return { customer, ents, email };
    },
    concurrency,
  );

  const result: PaidCustomerWithEmail[] = [];
  let nullEmail = 0;
  let relayEmail = 0;
  for (const { customer, ents, email } of withEmails) {
    if (!email) {
      nullEmail++;
      continue;
    }
    if (email.toLowerCase().endsWith("@privaterelay.appleid.com")) {
      relayEmail++;
      continue;
    }
    result.push({
      customerId: customer.id,
      email: email.toLowerCase().trim(),
      entitlement: ents[0].lookup_key ?? ents[0].id,
      firstSeenAt: customer.first_seen_at,
    });
  }
  log(
    `  done — ${result.length} paid customers with real email (skipped ${nullEmail} no-email, ${relayEmail} Apple-relay).`,
  );
  return result;
}
