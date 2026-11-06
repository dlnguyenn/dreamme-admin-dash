/**
 * Singular Reporting API client (bare fetch, no SDK).
 *
 * Mirrors the tiktok-ads.ts / meta-ads.ts retry+backoff pattern. Reads env
 * lazily inside functions so loadEnvConfig in CLI scripts works.
 *
 * Auth: `api_key` query param (Developer Tools > API Keys in the dashboard).
 *
 * ── RESPONSE SHAPE: OBSERVED LIVE (2026-08-12) ───────────────────────────
 * Confirmed against a real combined report (source=facebook, iOS, 35d):
 *   - Rows carry `start_date` + `end_date`; no `date` key.
 *   - `source` is CASED ("Facebook") — the mapper lowercases it; see below.
 *   - Cohort metric columns are keyed by the BARE auto-generated event id
 *     (e.g. "fdf7c893...", no `_7d` period suffix), and revenue by bare
 *     `revenue`. The `_${period}` candidates are kept first for tolerance.
 *   - Each cohort VALUE is an object keyed by period, e.g. `{ "7d": 3 }`
 *     (observed 2026-11-05). `cohortNum` unwraps it; a bare number still works.
 *   - `custom_installs` equals `tracker_installs` on this account, NOT the
 *     network number the docs suggest for SANs; `adn_installs` carries the
 *     network count. Both are stored separately.
 *
 * `mapSingularRows` still records unconsumed keys in `unmappedKeys` and the
 * cron route echoes them plus a sample row + the resolved cohort event ids —
 * that instrumentation is what confirmed all of the above in one run, and it
 * stays so any future shape drift announces itself.
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
 * AUTO-GENERATED id, never by display name — hardcoding the id means a silent
 * zero the day someone recreates the event in the Singular UI.
 *
 * The cache below lives for the PROCESS lifetime, which on a warm Vercel
 * lambda can span many cron invocations. Acceptable: the catalog changes only
 * when someone edits Settings > Events, and the worst case is one stale run
 * before the lambda recycles.
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

/**
 * Names RevenueCat's Singular integration may give a trial conversion. The
 * setup (docs/singular-mmp-setup.md, step 6) names it `rc_trial_converted`;
 * the rest tolerate a different choice in RevenueCat's dashboard.
 */
export const CONVERSION_EVENT_NAMES = ["rc_trial_converted", "rc trial converted", "trial converted", "trial_converted"];

/**
 * Cohort period for paid conversions. A trial converts about 7 days after it
 * starts, so a 7-day cohort cuts most conversions off; take 14 days, else 30,
 * from the periods the account offers. With no list, fall back to the base
 * period rather than ask for one the API may reject (that fails the sync).
 */
export function pickConversionPeriod(periods: string[], fallback = "7d"): string {
  for (const p of ["14d", "30d"]) if (periods.includes(p)) return p;
  return fallback;
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
  /** Trials converted to paid, from RevenueCat's trial-converted event, over the conversion period. */
  paid_conversions: number;
}

export interface SingularReportResult {
  rows: SingularCampaignRow[];
  /** Response keys we did not consume — see the PROVISIONAL note at the top. */
  unmappedKeys: string[];
  /** One raw row, so a live run can show us the real shape. */
  sampleRaw: Record<string, unknown> | null;
  /**
   * Which cohort event ids the catalog lookup actually resolved. Null means
   * the event was NOT requested in cohort_metrics at all — trials/subscribes
   * are then guaranteed zero no matter what the response contains, which is
   * indistinguishable from "no data" without this field. First live run
   * returned all-zero trials; this exists so the next run says why.
   */
  resolvedTrialEventId?: string | null;
  resolvedSubscribeEventId?: string | null;
  /** Null until RevenueCat's trial-converted event is registered in Singular's Settings > Events. */
  resolvedConversionEventId?: string | null;
  conversionPeriod?: string;
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

/**
 * A cohort metric's value. Observed live 2026-11-05: each one arrives as an
 * object keyed by period, e.g. `{ "7d": 3 }`, not as a bare number. Reading it
 * as a number gave NaN, so every trial and subscribe was stored as 0 while
 * Singular was reporting them.
 */
function cohortNum(v: unknown, period: string): number {
  if (v && typeof v === "object" && !Array.isArray(v)) return num((v as Record<string, unknown>)[period]);
  return num(v);
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
  opts: {
    trialEventId?: string | null;
    subscribeEventId?: string | null;
    conversionEventId?: string | null;
    cohortPeriod?: string;
    conversionPeriod?: string;
  } = {},
): SingularReportResult {
  const { trialEventId, subscribeEventId, conversionEventId, cohortPeriod = "7d" } = opts;
  const conversionPeriod = opts.conversionPeriod ?? cohortPeriod;
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

    // `app` is a requested dimension we don't store — consume it so it never
    // pollutes unmappedKeys, but note it CAN fan rows out (see merge below).
    // `end_date` pairs with start_date on every time_breakdown=day row
    // (observed live); we key rows on start_date alone.
    take(r, ["app"]);
    take(r, ["end_date"]);

    return {
      // LOWERCASED, and this is load-bearing: Singular returns "Facebook",
      // and every downstream consumer — singular_reconciliation, the meta-arm
      // enrichment, and the 4th UNION arm's `source <> 'facebook'` — filters
      // on the lowercase literal. On the first live sync the cased rows
      // leaked through that 4th arm as a phantom 'singular:Facebook' channel
      // and double-counted $11.3k of spend into the blended CAC.
      source: String(take(r, ["source", "adn_name"]) ?? "facebook").toLowerCase(),
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
      trial_starts: cohortNum(take(r, trialKeys), cohortPeriod),
      subscribes: cohortNum(take(r, subKeys), cohortPeriod),
      revenue: cohortNum(take(r, [`revenue_${cohortPeriod}`, "revenue", "cohort_revenue"]), cohortPeriod),
      paid_conversions: conversionEventId
        ? cohortNum(take(r, [`${conversionEventId}_${conversionPeriod}`, conversionEventId]), conversionPeriod)
        : 0,
    };
  });

  for (const r of raw) {
    for (const k of Object.keys(r)) if (!consumed.has(k)) unmapped.add(k);
  }

  // MERGE to the table's PK grain (source, campaign_id, date). The report is
  // requested with `app` and `os` dimensions, so Singular returns one row per
  // (app, os, campaign, date) — multiple rows sharing our PK. Passing those
  // through would put duplicate conflict keys in a single PostgREST INSERT,
  // and Postgres rejects that batch outright ("ON CONFLICT DO UPDATE command
  // cannot affect row a second time") — a 500 on the first run with real data.
  const merged = new Map<string, SingularCampaignRow>();
  for (const r of rows) {
    if (!r.campaign_id || !r.date) continue; // unusable — PK columns
    const key = `${r.source} ${r.campaign_id} ${r.date}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...r });
      continue;
    }
    prev.campaign_name = prev.campaign_name ?? r.campaign_name;
    // os only survives the merge if every fanned row agrees on it.
    prev.os = prev.os === r.os ? prev.os : null;
    prev.spend += r.spend;
    prev.installs += r.installs;
    prev.adn_installs += r.adn_installs;
    prev.tracker_installs += r.tracker_installs;
    prev.trial_starts += r.trial_starts;
    prev.subscribes += r.subscribes;
    prev.revenue += r.revenue;
    prev.paid_conversions += r.paid_conversions;
  }

  return {
    rows: [...merged.values()],
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
    error_message?: string;
  };
}

async function createReport(params: Record<string, string>): Promise<string> {
  const body = new URLSearchParams(params);
  // api_key rides in the QUERY STRING, matching the docs' own sample
  // (requests.post(url, params={"api_key": ...}, data=payload)). A form-body
  // api_key is nowhere documented and would surface as a 401 on the first
  // live call if Singular doesn't parse it.
  const res = await fetch(
    `${BASE_URL}/api/v2.0/create_async_report?api_key=${encodeURIComponent(getApiKey())}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
      cache: "no-store",
    },
  );
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
      // The docs say FAILED responses carry error_message — the only clue
      // Singular gives about why. Losing it means debugging blind.
      const detail = json.value?.error_message;
      throw new Error(
        `Singular report ${reportId} FAILED${detail ? `: ${detail}` : ""}`,
      );
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
  const conversionEventId = resolveEventId(catalog, CONVERSION_EVENT_NAMES);
  const conversionPeriod = conversionEventId ? pickConversionPeriod(catalog.periods, cohortPeriod) : cohortPeriod;
  const periods = [...new Set([cohortPeriod, conversionPeriod])].join(",");

  const cohortMetrics = [trialEventId, subscribeEventId, conversionEventId, "revenue"]
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
        cohort_periods: periods,
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

  const mapped = mapSingularRows(results.flat(), {
    trialEventId,
    subscribeEventId,
    conversionEventId,
    cohortPeriod,
    conversionPeriod,
  });
  return {
    ...mapped,
    resolvedTrialEventId: trialEventId,
    resolvedSubscribeEventId: subscribeEventId,
    resolvedConversionEventId: conversionEventId,
    conversionPeriod,
  };
}

// ---------------------------------------------------------------------------
// Breakdown probe (read-only)
// ---------------------------------------------------------------------------

export interface SingularProbeSummary {
  dimensions: string[];
  rows: number;
  installs: number;
  trials: number;
  /** How many distinct non-empty values each requested dimension returned. */
  distinct: Record<string, number>;
  /** Rows where a requested dimension came back empty, by dimension. */
  blank: Record<string, number>;
  /** Up to 25 groups, most trials first, summed over the window. */
  top: Array<Record<string, string | number>>;
}

/**
 * Sum a probe report over its date range, grouped by the requested dimensions.
 * Pure, so the shape Singular returns for a new breakdown can be pinned in a test.
 */
export function summarizeSingularProbe(
  raw: Array<Record<string, unknown>>,
  dimensions: string[],
  opts: { trialEventId?: string | null; cohortPeriod?: string } = {},
): SingularProbeSummary {
  const { trialEventId, cohortPeriod = "7d" } = opts;
  const groups = new Map<string, Record<string, string | number>>();
  const seen: Record<string, Set<string>> = Object.fromEntries(dimensions.map((d) => [d, new Set<string>()]));
  const blank: Record<string, number> = Object.fromEntries(dimensions.map((d) => [d, 0]));
  let installs = 0;
  let trials = 0;

  for (const r of raw) {
    const rowInstalls = num(r.tracker_installs);
    const rowTrials = trialEventId ? cohortNum(r[trialEventId], cohortPeriod) : 0;
    installs += rowInstalls;
    trials += rowTrials;
    const values = dimensions.map((d) => (r[d] == null ? "" : String(r[d])));
    values.forEach((v, i) => {
      if (v) seen[dimensions[i]].add(v);
      else blank[dimensions[i]] += 1;
    });
    const key = values.join("\u0001");
    const g = groups.get(key) ?? { ...Object.fromEntries(dimensions.map((d, i) => [d, values[i]])), installs: 0, trials: 0 };
    g.installs = (g.installs as number) + rowInstalls;
    g.trials = (g.trials as number) + rowTrials;
    groups.set(key, g);
  }

  return {
    dimensions,
    rows: raw.length,
    installs,
    trials,
    distinct: Object.fromEntries(dimensions.map((d) => [d, seen[d].size])),
    blank,
    top: [...groups.values()]
      .sort((a, b) => (b.trials as number) - (a.trials as number) || (b.installs as number) - (a.installs as number))
      .slice(0, 25),
  };
}

/**
 * Ask Singular for installs and trials broken down by any dimensions, e.g. ad
 * set or creative, and return a summary. Reads only; nothing is stored. One
 * request, so the window is capped at Singular's 30-day limit.
 */
export async function probeSingularBreakdown(opts: {
  startDate: string;
  endDate: string;
  dimensions: string[];
  source?: string;
  cohortPeriod?: string;
}): Promise<SingularProbeSummary & { sample: Record<string, unknown> | null }> {
  const { startDate, endDate, dimensions, source = "facebook", cohortPeriod = "7d" } = opts;
  const catalog = await fetchCohortMetricsCatalog();
  const trialEventId = resolveEventId(catalog, ["sng_start_trial", "start trial", "trial started"]);
  const [chunk] = chunkDateRange(startDate, endDate).slice(-1);
  if (!chunk) throw new Error("empty date range");

  const reportId = await createReport({
    start_date: chunk.start,
    end_date: chunk.end,
    time_breakdown: "all",
    format: "json",
    dimensions: dimensions.join(","),
    metrics: "tracker_installs",
    ...(trialEventId ? { cohort_metrics: trialEventId, cohort_periods: cohortPeriod } : {}),
    source,
  });
  const downloadUrl = await awaitReport(reportId);
  const payload = await singularFetchJson<{
    value?: { results?: Array<Record<string, unknown>> };
    results?: Array<Record<string, unknown>>;
  }>(downloadUrl);
  const rows = payload.value?.results ?? payload.results ?? [];
  return { ...summarizeSingularProbe(rows, dimensions, { trialEventId, cohortPeriod }), sample: rows[0] ?? null };
}

// ---------------------------------------------------------------------------
// Ad set and ad level (singular_ad_daily)
// ---------------------------------------------------------------------------

/** One row of public.singular_ad_daily. */
export interface SingularAdRow {
  source: string;
  campaign_id: string;
  campaign_name: string | null;
  /** Meta's ad set id. */
  adset_id: string;
  adset_name: string | null;
  /** Meta's ad id; "" when Singular reports the ad as "N/A". */
  ad_id: string;
  ad_name: string | null;
  date: string;
  os: string | null;
  installs: number;
  trial_starts: number;
  subscribes: number;
  paid_conversions: number;
}

/** Singular's dimension for Meta's ad set is `adn_sub_campaign_*`, for the ad `adn_creative_*`. */
export const SINGULAR_AD_DIMENSIONS =
  "app,source,os,unified_campaign_id,unified_campaign_name,adn_sub_campaign_id,adn_sub_campaign_name,adn_creative_id,adn_creative_name";

/** Singular writes "N/A" when it cannot name the ad set or ad. */
const named = (v: unknown): string => {
  const s = v == null ? "" : String(v).trim();
  return s === "N/A" ? "" : s;
};

/**
 * Pure mapper for the ad-level report, merged to the table's primary key
 * (source, campaign_id, adset_id, ad_id, date). Rows fan out by app and os
 * exactly as in mapSingularRows, so the same merge applies. The ad set and ad
 * ids are Meta's own (checked 2026-11-05), so they join to ad_insights_daily.
 */
export function mapSingularAdRows(
  raw: Array<Record<string, unknown>>,
  opts: {
    trialEventId?: string | null;
    subscribeEventId?: string | null;
    conversionEventId?: string | null;
    cohortPeriod?: string;
    conversionPeriod?: string;
  } = {},
): SingularAdRow[] {
  const { trialEventId, subscribeEventId, conversionEventId, cohortPeriod = "7d" } = opts;
  const conversionPeriod = opts.conversionPeriod ?? cohortPeriod;
  const pick = (r: Record<string, unknown>, keys: string[]): unknown => {
    const k = firstKey(r, keys);
    return k ? r[k] : undefined;
  };
  const merged = new Map<string, SingularAdRow>();
  for (const r of raw) {
    const row: SingularAdRow = {
      source: String(pick(r, ["source", "adn_name"]) ?? "facebook").toLowerCase(),
      campaign_id: String(pick(r, ["unified_campaign_id", "adn_campaign_id", "campaign_id"]) ?? ""),
      campaign_name: (pick(r, ["unified_campaign_name", "adn_campaign_name"]) as string) ?? null,
      adset_id: named(r.adn_sub_campaign_id),
      adset_name: named(r.adn_sub_campaign_name) || null,
      ad_id: named(r.adn_creative_id),
      ad_name: named(r.adn_creative_name) || null,
      date: String(pick(r, ["date", "start_date", "stat_date"]) ?? "").slice(0, 10),
      os: (r.os as string) ?? null,
      installs: num(pick(r, ["tracker_installs", "custom_installs"])),
      trial_starts: trialEventId ? cohortNum(pick(r, [`${trialEventId}_${cohortPeriod}`, trialEventId]), cohortPeriod) : 0,
      subscribes: subscribeEventId ? cohortNum(pick(r, [`${subscribeEventId}_${cohortPeriod}`, subscribeEventId]), cohortPeriod) : 0,
      paid_conversions: conversionEventId
        ? cohortNum(pick(r, [`${conversionEventId}_${conversionPeriod}`, conversionEventId]), conversionPeriod)
        : 0,
    };
    if (!row.campaign_id || !row.date) continue;
    const key = [row.source, row.campaign_id, row.adset_id, row.ad_id, row.date].join("\u0001");
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, row);
      continue;
    }
    prev.campaign_name = prev.campaign_name ?? row.campaign_name;
    prev.adset_name = prev.adset_name ?? row.adset_name;
    prev.ad_name = prev.ad_name ?? row.ad_name;
    prev.os = prev.os === row.os ? prev.os : null;
    prev.installs += row.installs;
    prev.trial_starts += row.trial_starts;
    prev.subscribes += row.subscribes;
    prev.paid_conversions += row.paid_conversions;
  }
  return [...merged.values()];
}

/**
 * Installs, trials and subscribes per Meta ad set and ad, per day, for
 * [startDate, endDate]. Same event lookup, chunking and cohort period as the
 * campaign report; no cost (that comes from Meta per ad).
 */
export async function fetchSingularAdReport(opts: {
  startDate: string;
  endDate: string;
  source?: string;
  cohortPeriod?: string;
}): Promise<{ rows: SingularAdRow[]; conversionPeriod: string }> {
  const { startDate, endDate, source = "facebook", cohortPeriod = "7d" } = opts;
  const catalog = await fetchCohortMetricsCatalog();
  const trialEventId = resolveEventId(catalog, ["sng_start_trial", "start trial", "trial started"]);
  const subscribeEventId = resolveEventId(catalog, ["sng_subscribe", "subscribe"]);
  const conversionEventId = resolveEventId(catalog, CONVERSION_EVENT_NAMES);
  const conversionPeriod = conversionEventId ? pickConversionPeriod(catalog.periods, cohortPeriod) : cohortPeriod;
  const periods = [...new Set([cohortPeriod, conversionPeriod])].join(",");
  const cohortMetrics = [trialEventId, subscribeEventId, conversionEventId].filter(Boolean).join(",");

  const results = await Promise.all(
    chunkDateRange(startDate, endDate).map(async (c) => {
      const reportId = await createReport({
        start_date: c.start,
        end_date: c.end,
        time_breakdown: "day",
        format: "json",
        dimensions: SINGULAR_AD_DIMENSIONS,
        metrics: "tracker_installs",
        ...(cohortMetrics ? { cohort_metrics: cohortMetrics, cohort_periods: periods } : {}),
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
  return {
    rows: mapSingularAdRows(results.flat(), { trialEventId, subscribeEventId, conversionEventId, cohortPeriod, conversionPeriod }),
    conversionPeriod,
  };
}
