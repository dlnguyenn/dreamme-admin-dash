/**
 * Mixpanel Query API (bare fetch, no SDK) — daily event counts for the dash.
 *
 * Used for the top-of-funnel denominator on the Overview: RevenueCat knows
 * how many trials started, but only Mixpanel knows how many people began
 * onboarding at all. The consumer `users` table is NOT a substitute — it runs
 * a consistent ~75% of onboarding_started because a row only exists once a
 * user gets far enough to create an account, so using it would silently
 * inflate the trial rate by about a third.
 *
 * Timezone: the DreamMe project is set to US/Eastern, which is the same
 * boundary the trial-starts view buckets on (migration 0060). That alignment
 * is what makes trials/onboarding a valid ratio — verified 2026-08-07 by
 * checking that the newest hourly bucket tracks Eastern wall-clock, not UTC.
 * If the project timezone is ever changed, this ratio breaks silently.
 *
 * Auth: a Mixpanel service account (username + secret), Basic auth. Project
 * id is not a secret and defaults to DreamMe's.
 *
 * Rate limit: the Query API allows ~60 queries/hour per project, so results
 * are cached in-module for CACHE_TTL_MS. The dash is a handful of page loads
 * a day, but a refresh loop shouldn't be able to burn the quota.
 */

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const CACHE_TTL_MS = 5 * 60_000;

/** Default host; EU/IN data residency would need eu./in. prefixes. */
function apiHost(): string {
  return process.env.MIXPANEL_API_HOST ?? "https://mixpanel.com";
}

function serviceAccount(): string {
  return process.env.MIXPANEL_SERVICE_ACCOUNT_USER ?? "";
}

function serviceSecret(): string {
  return process.env.MIXPANEL_SERVICE_ACCOUNT_SECRET ?? "";
}

export function mixpanelProjectId(): string {
  return process.env.MIXPANEL_PROJECT_ID ?? "3972700";
}

export function mixpanelConfigured(): boolean {
  return !!serviceAccount() && !!serviceSecret();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const cache = new Map<string, { at: number; value: Map<string, number> }>();

interface SegmentationResponse {
  data?: {
    series?: string[];
    values?: Record<string, Record<string, number>>;
  };
}

async function query<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!mixpanelConfigured()) {
    throw new Error(
      "MIXPANEL_SERVICE_ACCOUNT_USER / MIXPANEL_SERVICE_ACCOUNT_SECRET not set",
    );
  }
  const qs = new URLSearchParams({
    project_id: mixpanelProjectId(),
    ...params,
  });
  const auth = Buffer.from(
    `${serviceAccount()}:${serviceSecret()}`,
  ).toString("base64");

  let attempt = 0;
  while (true) {
    const res = await fetch(`${apiHost()}${path}?${qs.toString()}`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.ok) return (await res.json()) as T;
    const text = (await res.text()).slice(0, 200);
    if (!RETRYABLE.has(res.status) || attempt >= 2) {
      throw new Error(`Mixpanel ${res.status}: ${text}`);
    }
    await sleep(500 * Math.pow(2, attempt));
    attempt++;
  }
}

/**
 * Unique users per day for one event, keyed by YYYY-MM-DD in the project's
 * timezone. Dates are inclusive on both ends.
 */
export async function dailyUniques(
  event: string,
  fromDate: string,
  toDate: string,
): Promise<Map<string, number>> {
  const key = `${event}|${fromDate}|${toDate}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const body = await query<SegmentationResponse>("/api/query/segmentation", {
    event,
    from_date: fromDate,
    to_date: toDate,
    unit: "day",
    type: "unique",
  });

  const values = body.data?.values?.[event] ?? {};
  const out = new Map<string, number>();
  for (const [date, n] of Object.entries(values)) {
    const parsed = Number(n);
    if (Number.isFinite(parsed)) out.set(date.slice(0, 10), parsed);
  }
  cache.set(key, { at: Date.now(), value: out });
  return out;
}

const segCache = new Map<string, { at: number; value: Map<string, Map<string, number>> }>();

/**
 * Unique users per day for one event, split by a property expression
 * (`on`, e.g. `user["referral_source"]`) and optionally filtered (`where`,
 * e.g. `properties["platform"]=="ios"`). Returns segment -> date -> count.
 * Used by the step-down test to split trials by the onboarding answer.
 */
export async function segmentationOn(
  event: string,
  fromDate: string,
  toDate: string,
  on: string,
  where?: string,
): Promise<Map<string, Map<string, number>>> {
  const key = `${event}|${fromDate}|${toDate}|${on}|${where ?? ""}`;
  const hit = segCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const body = await query<SegmentationResponse>("/api/query/segmentation", {
    event,
    from_date: fromDate,
    to_date: toDate,
    unit: "day",
    type: "unique",
    on,
    ...(where ? { where } : {}),
  });

  const out = new Map<string, Map<string, number>>();
  for (const [segment, days] of Object.entries(body.data?.values ?? {})) {
    const m = new Map<string, number>();
    for (const [date, n] of Object.entries(days)) {
      const parsed = Number(n);
      if (Number.isFinite(parsed)) m.set(date.slice(0, 10), parsed);
    }
    out.set(segment, m);
  }
  segCache.set(key, { at: Date.now(), value: out });
  return out;
}

/**
 * Run a JQL script (POST /api/query/jql) and return its rows. JQL sees every
 * event at once, which is how the App Analytics daily sync gets all events'
 * users and totals in ONE query instead of one per event. Two things to know:
 * `event.time` and the from/to dates are UTC here (the segmentation endpoints
 * above use the project's Eastern days), and a query counts against the same
 * ~60/hour limit. Not cached: callers store what they fetch.
 */
export async function jql<T>(script: string, params: Record<string, unknown>): Promise<T[]> {
  if (!mixpanelConfigured()) {
    throw new Error(
      "MIXPANEL_SERVICE_ACCOUNT_USER / MIXPANEL_SERVICE_ACCOUNT_SECRET not set",
    );
  }
  const auth = Buffer.from(
    `${serviceAccount()}:${serviceSecret()}`,
  ).toString("base64");
  const url = `${apiHost()}/api/query/jql?project_id=${encodeURIComponent(mixpanelProjectId())}`;

  let attempt = 0;
  while (true) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ script, params: JSON.stringify(params) }),
      cache: "no-store",
    });
    if (res.ok) {
      const body = (await res.json()) as unknown;
      if (!Array.isArray(body)) throw new Error("Mixpanel JQL returned something other than rows");
      return body as T[];
    }
    const text = (await res.text()).slice(0, 300);
    if (!RETRYABLE.has(res.status) || attempt >= 2) {
      throw new Error(`Mixpanel JQL ${res.status}: ${text}`);
    }
    await sleep(1000 * Math.pow(2, attempt));
    attempt++;
  }
}

/** Exposed for tests — module-level cache would otherwise leak between them. */
export function clearMixpanelCache(): void {
  cache.clear();
  segCache.clear();
}
