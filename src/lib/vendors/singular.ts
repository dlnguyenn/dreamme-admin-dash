/**
 * Singular Reporting API client (bare fetch, no SDK).
 *
 * Mirrors the tiktok-ads.ts / meta-ads.ts retry+backoff pattern. Reads env
 * lazily inside functions so loadEnvConfig in CLI scripts works.
 *
 * Auth: `api_key` query param (Developer Tools > API Keys in the dashboard).
 *
 * ── PROVISIONAL RESPONSE SHAPE ────────────────────────────────────────────
 * This client was written against Singular's published API docs BEFORE the
 * account was configured, so no real response has ever been observed. The
 * request side (async job flow, chunking, rate limits) is well specified. The
 * RESPONSE side — particularly how cohort metrics are keyed — is not, and is
 * the part most likely to be wrong.
 *
 * Rather than guess and silently return zeros, `mapSingularRows` records every
 * response key it did not consume in `unmappedKeys`, and the cron route echoes
 * those plus a sample row. The first live run therefore TELLS US the real
 * shape instead of quietly producing an empty dashboard. Fix the key lookups
 * here once that lands, then delete this notice.
 *
 * Field renames (Singular ↔ our schema):
 *   adn_cost              ↔ spend
 *   custom_installs       ↔ installs   (for SANs like Facebook this is
 *                                       deliberately the NETWORK number)
 *   unified_campaign_id   ↔ campaign_id
 *   <cohort event id>     ↔ trial_starts / subscribes
 */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const BASE_URL = "https://api.singular.net";

// Singular allows at most 30 days per report request.
const MAX_SPAN_DAYS = 30;
// Poll no more than once per 10s per the API docs.
const POLL_INTERVAL_MS = 10_000;
// Stay inside the route's maxDuration=300 budget.
const POLL_BUDGET_MS = 240_000;

function getApiKey(): string {
  return process.env.SINGULAR_REPORTING_API_KEY ?? "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function singularConfigured(): boolean {
  return !!getApiKey();
}

async function singularFetchJson<T>(url: string, maxRetries = 4): Promise<T> {
  const key = getApiKey();
  if (!key) throw new Error("SINGULAR_REPORTING_API_KEY not set");
  let attempt = 0;
  while (true) {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (res.ok) {
      return (await res.json()) as T;
    }
    const text = await res.text();
    if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
      // 403 here is almost always field permissions on the API key's user,
      // not a bad key — the docs are explicit about that.
      throw new Error(
        `Singular API error: ${res.status} ${text.slice(0, 200)}`,
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

// ---------------------------------------------------------------------------
// Cohort event ids
// ---------------------------------------------------------------------------

/**
 * Custom/standard events are addressed in `cohort_metrics=` by an
 * AUTO-GENERATED id, never by display name. Resolve at runtime and cache for
 * the request lifetime — hardcoding the id means a silent zero the day someone
 * recreates the event in the Singular UI.
 */
export interface CohortMetricsCatalog {
  byName: Record<string, string>;
  periods: string[];
}

let catalogCache: CohortMetricsCatalog | null = null;

export async function fetchCohortMetricsCatalog(): Promise<CohortMetricsCatalog> {
  if (catalogCache) return catalogCache;
  const url = `${BASE_URL}/api/cohort_metrics?api_key=${encodeURIComponent(getApiKey())}`;
  const body = await singularFetchJson<{
    metrics?: Array<{ display_name?: string; name?: string }>;
    periods?: string[];
    value?: {
      metrics?: Array<{ display_name?: string; name?: string }>;
      periods?: string[];
    };
  }>(url);
  const metrics = body.metrics ?? body.value?.metrics ?? [];
  const byName: Record<string, string> = {};
  for (const m of metrics) {
    if (m.display_name && m.name) byName[m.display_name.toLowerCase()] = m.name;
    // Some accounts return the raw event name as display_name; index both.
    if (m.name) byName[m.name.toLowerCase()] = m.name;
  }
  catalogCache = { byName, periods: body.periods ?? body.value?.periods ?? [] };
  return catalogCache;
}

/** Test seam — the module-level cache would otherwise leak across cases. */
export function __resetSingularCaches(): void {
  catalogCache = null;
}

/**
 * Resolve an event id by any of several candidate display names, so a rename
 * in the Singular UI degrades to "not found" rather than a wrong id.
 */
export function resolveEventId(
  catalog: CohortMetricsCatalog,
  candidates: string[],
): string | null {
  for (const c of candidates) {
    const hit = catalog.byName[c.toLowerCase()];
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Async report job
// ---------------------------------------------------------------------------

export interface SingularCampaignRow {
  source: string;
  campaign_id: string;
  campaign_name: string | null;
  date: string;
  os: string | null;
  spend: number;
  installs: number;
  adn_installs: number;
  tracker_installs: number;
  trial_starts: number;
  subscribes: number;
  revenue: number;
}

export interface SingularReportResult {
  rows: SingularCampaignRow[];
  /** Response keys we did not consume — see the PROVISIONAL note at the top. */
  unmappedKeys: string[];
  /** One raw row, so a live run can show us the real shape. */
  sampleRaw: Record<string, unknown> | null;
}

/** Inclusive [start, end] split into <= MAX_SPAN_DAYS chunks. */
export function chunkDateRange(
  startDate: string,
  endDate: string,
  maxSpanDays = MAX_SPAN_DAYS,
): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (end < start) return out;
  const dayMs = 86_400_000;
  let cursor = start;
  while (cursor <= end) {
    const chunkEndMs = Math.min(
      cursor.getTime() + (maxSpanDays - 1) * dayMs,
      end.getTime(),
    );
    out.push({
      start: cursor.toISOString().slice(0, 10),
      end: new Date(chunkEndMs).toISOString().slice(0, 10),
    });
    cursor = new Date(chunkEndMs + dayMs);
  }
  return out;
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

function firstKey(
  row: Record<string, unknown>,
  candidates: string[],
): string | null {
  for (const c of candidates) {
    if (c && Object.prototype.hasOwnProperty.call(row, c)) return c;
  }
  return null;
}

/**
 * Pure response -> row mapper. Kept separate from the network layer so the
 * vitest suite can pin it against a fixture without mocking the poll loop.
 */
export function mapSingularRows(
  raw: Array<Record<string, unknown>>,
  opts: { trialEventId?: string | null; subscribeEventId?: string | null; cohortPeriod?: string } = {},
): SingularReportResult {
  const { trialEventId, subscribeEventId, cohortPeriod = "7d" } = opts;
  const consumed = new Set<string>();
  const unmapped = new Set<string>();

  const take = (row: Record<string, unknown>, candidates: string[]): unknown => {
    const k = firstKey(row, candidates);
    if (!k) return undefined;
    consumed.add(k);
    return row[k];
  };

  const rows = raw.map((r) => {
    // Cohort metrics are commonly keyed `<id>` or `<id>_<period>`; try both,
    // plus the human names in case the account returns those instead.
    const trialKeys = trialEventId
      ? [`${trialEventId}_${cohortPeriod}`, trialEventId, `sng_start_trial_${cohortPeriod}`, "sng_start_trial"]
      : [`sng_start_trial_${cohortPeriod}`, "sng_start_trial"];
    const subKeys = subscribeEventId
      ? [`${subscribeEventId}_${cohortPeriod}`, subscribeEventId, `sng_subscribe_${cohortPeriod}`, "sng_subscribe"]
      : [`sng_subscribe_${cohortPeriod}`, "sng_subscribe"];

    return {
      source: String(take(r, ["source", "adn_name"]) ?? "facebook"),
      campaign_id: String(
        take(r, ["unified_campaign_id", "adn_campaign_id", "campaign_id"]) ?? "",
      ),
      campaign_name:
        (take(r, ["unified_campaign_name", "adn_campaign_name", "campaign_name"]) as string) ??
        null,
      date: String(take(r, ["date", "start_date", "stat_date"]) ?? "").slice(0, 10),
      os: (take(r, ["os", "platform"]) as string) ?? null,
      spend: num(take(r, ["adn_cost", "adn_original_cost", "cost"])),
      installs: num(take(r, ["custom_installs", "installs"])),
      adn_installs: num(take(r, ["adn_installs"])),
      tracker_installs: num(take(r, ["tracker_installs"])),
      trial_starts: num(take(r, trialKeys)),
      subscribes: num(take(r, subKeys)),
      revenue: num(take(r, [`revenue_${cohortPeriod}`, "revenue", "cohort_revenue"])),
    };
  });

  for (const r of raw) {
    for (const k of Object.keys(r)) if (!consumed.has(k)) unmapped.add(k);
  }

  return {
    // A row with no campaign id is unusable downstream (it is the PK).
    rows: rows.filter((r) => r.campaign_id && r.date),
    unmappedKeys: [...unmapped].sort(),
    sampleRaw: raw[0] ?? null,
  };
}

interface CreateReportResponse {
  status?: number;
  value?: { report_id?: string };
  report_id?: string;
}

interface ReportStatusResponse {
  status?: number;
  value?: {
    status?: string;
    download_url?: string;
    url?: string;
  };
}

async function createReport(params: Record<string, string>): Promise<string> {
  const body = new URLSearchParams({ ...params, api_key: getApiKey() });
  const res = await fetch(`${BASE_URL}/api/v2.0/create_async_report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `Singular create_async_report failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as CreateReportResponse;
  const id = json.value?.report_id ?? json.report_id;
  if (!id) throw new Error("Singular create_async_report returned no report_id");
  return id;
}

async function awaitReport(reportId: string): Promise<string> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const url = `${BASE_URL}/api/v2.0/get_report_status?report_id=${encodeURIComponent(reportId)}&api_key=${encodeURIComponent(getApiKey())}`;
    const json = await singularFetchJson<ReportStatusResponse>(url);
    const state = (json.value?.status ?? "").toUpperCase();
    if (state === "DONE") {
      const dl = json.value?.download_url ?? json.value?.url;
      if (!dl) throw new Error("Singular report DONE but no download_url");
      return dl;
    }
    if (state === "FAILED") {
      throw new Error(`Singular report ${reportId} FAILED`);
    }
    // QUEUED / STARTED — keep waiting.
  }
  // Let the caller 502 so Vercel's cron simply retries tomorrow; the docs say
  // treat >30min as stuck, and we are well inside the route budget here.
  throw new Error(
    `Singular report ${reportId} still running after ${POLL_BUDGET_MS / 1000}s`,
  );
}

/**
 * Fetch per-campaign Meta cost + cohort trial counts for [startDate, endDate].
 *
 * Chunks the window to Singular's 30-day request limit and runs the chunks
 * CONCURRENTLY (the API allows 100 concurrent async reports). Deliberately NOT
 * day-by-day: `date` is a dimension, so one request already returns per-day
 * rows, and 35 sequential create-then-poll cycles would blow the route budget.
 */
export async function fetchSingularCampaignReport(opts: {
  startDate: string;
  endDate: string;
  source?: string;
  cohortPeriod?: string;
}): Promise<SingularReportResult> {
  const { startDate, endDate, source = "facebook", cohortPeriod = "7d" } = opts;

  const catalog = await fetchCohortMetricsCatalog();
  const trialEventId = resolveEventId(catalog, [
    "sng_start_trial",
    "start trial",
    "trial started",
  ]);
  const subscribeEventId = resolveEventId(catalog, ["sng_subscribe", "subscribe"]);

  const cohortMetrics = [trialEventId, subscribeEventId, "revenue"]
    .filter(Boolean)
    .join(",");

  const chunks = chunkDateRange(startDate, endDate);
  const results = await Promise.all(
    chunks.map(async (c) => {
      const reportId = await createReport({
        start_date: c.start,
        end_date: c.end,
        time_breakdown: "day",
        format: "json",
        dimensions:
          "app,source,os,unified_campaign_id,unified_campaign_name",
        metrics: "adn_cost,custom_installs,adn_installs,tracker_installs",
        cohort_metrics: cohortMetrics,
        cohort_periods: cohortPeriod,
        source,
      });
      const downloadUrl = await awaitReport(reportId);
      const payload = await singularFetchJson<{
        value?: { results?: Array<Record<string, unknown>> };
        results?: Array<Record<string, unknown>>;
      }>(downloadUrl);
      return payload.value?.results ?? payload.results ?? [];
    }),
  );

  return mapSingularRows(results.flat(), {
    trialEventId,
    subscribeEventId,
    cohortPeriod,
  });
}
