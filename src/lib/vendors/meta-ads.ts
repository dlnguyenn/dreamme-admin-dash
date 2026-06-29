/**
 * Meta Marketing API client (bare fetch, no SDK). Mirrors the retry/backoff
 * pattern in src/lib/vendors/anthropic-admin.ts.
 *
 * Long-lived token expires ~2026-06-30 — the client surfaces a clear error
 * when Meta returns code 190 (invalid/expired token).
 */
// Read env lazily inside functions — top-level constants capture process.env
// before loadEnvConfig runs in CLI scripts (ESM imports hoist).
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function getToken(): string {
  return process.env.META_ACCESS_TOKEN ?? "";
}
function getApiVersion(): string {
  return process.env.META_API_VERSION ?? "v22.0";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function metaAdsConfigured(): boolean {
  return !!getToken();
}

export interface AdInsightAction {
  action_type: string;
  value: string;
}

export interface AdInsightRow {
  ad_id: string;
  ad_name: string;
  adset_id: string;
  adset_name: string;
  campaign_id: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  installs: number;
  startTrials: number;
  storeVisits: number;
  raw_actions: AdInsightAction[];
}

interface InsightsResponse {
  data?: Array<Record<string, unknown>>;
  paging?: { next?: string };
  error?: { message?: string; code?: number; type?: string };
}

// DreamMe-specific: the iOS FB SDK auto-logs trial-start as
// `fb_mobile_complete_registration` (not `fb_mobile_subscription_start_trial`).
// Verified 2026-05-01 against 30d data: 230 complete_registration events vs
// 117 n8n trial_qualified (50.9% qualified rate, matches expected ~half).
// If a future SDK update changes this, the script's diagnostic will surface
// zero counts and dump action-type volumes — re-pick by count and update here.
const START_TRIAL_ACTION_TYPES = new Set([
  "app_custom_event.fb_mobile_complete_registration",
]);

const INSTALL_ACTION_TYPES = new Set([
  "mobile_app_install",
  "app_install",
]);

// Mirror trial-start logic for iOS-SDK purchase events.
const PURCHASE_ACTION_TYPES = new Set([
  "app_custom_event.fb_mobile_purchase",
]);

// Meta reports "3-second video plays" as the `video_view` action type inside
// the `actions` array. Hook rate = these ÷ impressions.
const VIDEO_3SEC_ACTION_TYPES = new Set(["video_view"]);

// App Store product-page views — the SKAN-neutral intent proxy. Meta reports
// these as the `app_store_visit` action type. Cost-per-store-visit = spend ÷ this.
const STORE_VISIT_ACTION_TYPES = new Set(["app_store_visit"]);

function sumActions(
  actions: AdInsightAction[] | undefined,
  types: Set<string>,
): number {
  if (!actions) return 0;
  let total = 0;
  for (const a of actions) {
    if (types.has(a.action_type)) total += Number(a.value) || 0;
  }
  return total;
}

async function metaFetchJson<T>(
  url: string,
  maxRetries: number,
  token?: string,
): Promise<T> {
  const TOKEN = token ?? getToken();
  if (!TOKEN) throw new Error("META_ACCESS_TOKEN not set");
  const headers = { Authorization: `Bearer ${TOKEN}` };
  let attempt = 0;
  while (true) {
    const res = await fetch(url, { headers, cache: "no-store" });
    if (res.ok) return (await res.json()) as T;
    const text = await res.text();
    let err = text;
    try {
      const j = JSON.parse(text) as {
        error?: { message?: string; code?: number; type?: string };
      };
      if (j.error) {
        if (j.error.code === 190) {
          err = `Token expired or invalid (code 190): ${j.error.message ?? ""}. Generate a new long-lived token.`;
        } else {
          err = `${j.error.code ?? "?"} ${j.error.type ?? ""} ${j.error.message ?? ""}`.trim();
        }
      }
    } catch {
      // not JSON — fall through with raw text
    }
    if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
      throw new Error(`Meta API error: ${res.status} ${err}`);
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

export async function fetchAdInsights(params: {
  accountId: string; // act_XXXXXXXXX
  since: string; // YYYY-MM-DD (inclusive)
  until: string; // YYYY-MM-DD (inclusive)
  maxRetries?: number;
  accessToken?: string; // overrides env META_ACCESS_TOKEN (e.g. OAuth connection)
}): Promise<AdInsightRow[]> {
  const TOKEN = params.accessToken ?? getToken();
  const API_VERSION = getApiVersion();
  if (!TOKEN) throw new Error("META_ACCESS_TOKEN not set");
  const maxRetries = params.maxRetries ?? 4;

  const fields = [
    "ad_id",
    "ad_name",
    "adset_id",
    "adset_name",
    "campaign_id",
    "campaign_name",
    "spend",
    "impressions",
    "clicks",
    "actions",
  ].join(",");

  const qs = new URLSearchParams({
    level: "ad",
    fields,
    time_range: JSON.stringify({ since: params.since, until: params.until }),
    time_increment: "all_days",
    limit: "500",
  });

  let url = `https://graph.facebook.com/${API_VERSION}/${params.accountId}/insights?${qs.toString()}`;
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const out: AdInsightRow[] = [];

  while (true) {
    let attempt = 0;
    let body: InsightsResponse | null = null;
    while (true) {
      const res = await fetch(url, { headers, cache: "no-store" });
      if (res.ok) {
        body = (await res.json()) as InsightsResponse;
        break;
      }
      const text = await res.text();
      let err = text;
      try {
        const j = JSON.parse(text) as InsightsResponse;
        if (j.error) {
          if (j.error.code === 190) {
            err = `Token expired or invalid (code 190): ${j.error.message ?? ""}. Generate a new long-lived token.`;
          } else {
            err = `${j.error.code ?? "?"} ${j.error.type ?? ""} ${j.error.message ?? ""}`.trim();
          }
        }
      } catch {
        // not JSON — fall through with raw text
      }
      if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
        throw new Error(`Meta insights error: ${res.status} ${err}`);
      }
      const retryAfter = res.headers.get("retry-after");
      const retryMs = retryAfter
        ? Math.max(0, Math.min(60_000, Number(retryAfter) * 1000))
        : 0;
      const backoff = Math.min(32_000, 1000 * Math.pow(2, attempt));
      await sleep(retryMs || backoff + Math.floor(Math.random() * 250));
      attempt++;
    }

    for (const row of body?.data ?? []) {
      const actions = (row.actions as AdInsightAction[] | undefined) ?? [];
      out.push({
        ad_id: String(row.ad_id ?? ""),
        ad_name: String(row.ad_name ?? ""),
        adset_id: String(row.adset_id ?? ""),
        adset_name: String(row.adset_name ?? ""),
        campaign_id: String(row.campaign_id ?? ""),
        campaign_name: String(row.campaign_name ?? ""),
        spend: Number(row.spend ?? 0),
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        installs: sumActions(actions, INSTALL_ACTION_TYPES),
        startTrials: sumActions(actions, START_TRIAL_ACTION_TYPES),
        storeVisits: sumActions(actions, STORE_VISIT_ACTION_TYPES),
        raw_actions: actions,
      });
    }

    if (!body?.paging?.next) break;
    url = body.paging.next;
  }

  return out;
}

export interface AdInsightRowWithCreative extends AdInsightRow {
  date: string; // YYYY-MM-DD
  status: string;
  effective_status: string;
  unique_clicks: number;
  purchases: number;
  purchase_value: number;
  creative_id: string;
  creative_name: string;
  thumbnail_url: string;
  image_url: string;
  video_id: string;
  message: string;
  headline: string;
  video_3sec_views: number;
  video_thruplays: number;
}

interface AdMetaRow {
  id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  creative?: {
    id?: string;
    name?: string;
    thumbnail_url?: string;
    image_url?: string;
    video_id?: string;
    object_story_spec?: {
      link_data?: { message?: string; name?: string; caption?: string };
      video_data?: { message?: string; title?: string };
      template_data?: { message?: string; name?: string };
    };
  };
}

interface AdsResponse {
  data?: AdMetaRow[];
  paging?: { next?: string };
}

interface InsightsDailyRow {
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  date_start?: string;
  date_stop?: string;
  spend?: string | number;
  impressions?: string | number;
  clicks?: string | number;
  unique_clicks?: string | number;
  actions?: AdInsightAction[];
  action_values?: AdInsightAction[];
  video_thruplay_watched_actions?: AdInsightAction[];
}

/**
 * Fetch ad-level insights with one row per (ad, day) and join creative
 * metadata (thumbnail, status, copy) from /{account}/ads. Used by the
 * sync-ad-insights cron to populate `ad_insights_daily`.
 *
 * Note: Meta's /{account}/insights endpoint doesn't accept `creative` as a
 * sub-field — we batch a separate /{account}/ads call and join by ad_id.
 */
export async function fetchAdInsightsWithCreative(params: {
  accountId: string;
  since: string;
  until: string;
  timeIncrement?: number | "all_days";
  maxRetries?: number;
  accessToken?: string; // overrides env META_ACCESS_TOKEN (e.g. OAuth connection)
}): Promise<AdInsightRowWithCreative[]> {
  const API_VERSION = getApiVersion();
  const maxRetries = params.maxRetries ?? 4;
  const timeIncrement = params.timeIncrement ?? 1;

  const insightFields = [
    "ad_id",
    "ad_name",
    "adset_id",
    "adset_name",
    "campaign_id",
    "campaign_name",
    "spend",
    "impressions",
    "clicks",
    "unique_clicks",
    "actions",
    "action_values",
    "video_thruplay_watched_actions",
    "date_start",
    "date_stop",
  ].join(",");

  const insightsQs = new URLSearchParams({
    level: "ad",
    fields: insightFields,
    time_range: JSON.stringify({ since: params.since, until: params.until }),
    time_increment: String(timeIncrement),
    limit: "500",
  });

  const adFields = [
    "id",
    "name",
    "status",
    "effective_status",
    "creative{id,name,thumbnail_url,image_url,video_id,object_story_spec}",
  ].join(",");
  const adsQs = new URLSearchParams({ fields: adFields, limit: "500" });

  const adMetaMap = new Map<string, AdMetaRow>();
  let adsUrl = `https://graph.facebook.com/${API_VERSION}/${params.accountId}/ads?${adsQs.toString()}`;
  while (true) {
    const body = await metaFetchJson<AdsResponse>(adsUrl, maxRetries, params.accessToken);
    for (const ad of body.data ?? []) {
      if (ad.id) adMetaMap.set(ad.id, ad);
    }
    if (!body.paging?.next) break;
    adsUrl = body.paging.next;
  }

  const out: AdInsightRowWithCreative[] = [];
  let insightsUrl = `https://graph.facebook.com/${API_VERSION}/${params.accountId}/insights?${insightsQs.toString()}`;
  while (true) {
    const body = await metaFetchJson<{
      data?: InsightsDailyRow[];
      paging?: { next?: string };
    }>(insightsUrl, maxRetries, params.accessToken);

    for (const row of body.data ?? []) {
      const adId = String(row.ad_id ?? "");
      if (!adId) continue;
      const actions = row.actions ?? [];
      const actionValues = row.action_values ?? [];
      const meta = adMetaMap.get(adId);
      const creative = meta?.creative;
      const oss = creative?.object_story_spec;
      const message =
        oss?.link_data?.message ??
        oss?.video_data?.message ??
        oss?.template_data?.message ??
        "";
      const headline =
        oss?.link_data?.name ??
        oss?.video_data?.title ??
        oss?.template_data?.name ??
        "";

      out.push({
        ad_id: adId,
        ad_name: String(row.ad_name ?? meta?.name ?? ""),
        adset_id: String(row.adset_id ?? ""),
        adset_name: String(row.adset_name ?? ""),
        campaign_id: String(row.campaign_id ?? ""),
        campaign_name: String(row.campaign_name ?? ""),
        spend: Number(row.spend ?? 0),
        impressions: Number(row.impressions ?? 0),
        clicks: Number(row.clicks ?? 0),
        unique_clicks: Number(row.unique_clicks ?? 0),
        installs: sumActions(actions, INSTALL_ACTION_TYPES),
        startTrials: sumActions(actions, START_TRIAL_ACTION_TYPES),
        purchases: sumActions(actions, PURCHASE_ACTION_TYPES),
        purchase_value: sumActions(actionValues, PURCHASE_ACTION_TYPES),
        storeVisits: sumActions(actions, STORE_VISIT_ACTION_TYPES),
        raw_actions: actions,
        date: String(row.date_start ?? ""),
        status: String(meta?.status ?? ""),
        effective_status: String(meta?.effective_status ?? ""),
        creative_id: String(creative?.id ?? ""),
        creative_name: String(creative?.name ?? ""),
        thumbnail_url: String(creative?.thumbnail_url ?? ""),
        image_url: String(creative?.image_url ?? ""),
        video_id: String(creative?.video_id ?? ""),
        message,
        headline,
        video_3sec_views: sumActions(actions, VIDEO_3SEC_ACTION_TYPES),
        video_thruplays: (row.video_thruplay_watched_actions ?? []).reduce(
          (s, a) => s + Number(a.value ?? 0),
          0,
        ),
      });
    }

    if (!body.paging?.next) break;
    insightsUrl = body.paging.next;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Custom Audience + Lookalike management
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";

/** SHA-256 of trimmed, lowercased email — Meta's required normalization. */
export function hashEmailForMeta(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase(), "utf8")
    .digest("hex");
}

async function metaPostJson<T>(
  url: string,
  body: Record<string, unknown>,
  maxRetries = 4,
  token?: string,
): Promise<T> {
  const TOKEN = token ?? getToken();
  if (!TOKEN) throw new Error("META_ACCESS_TOKEN not set");
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
  let attempt = 0;
  while (true) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (res.ok) return (await res.json()) as T;
    const text = await res.text();
    let err = text;
    try {
      const j = JSON.parse(text) as {
        error?: { message?: string; code?: number; type?: string };
      };
      if (j.error) {
        if (j.error.code === 190) {
          err = `Token expired/invalid (code 190): ${j.error.message ?? ""}.`;
        } else {
          err = `${j.error.code ?? "?"} ${j.error.type ?? ""} ${j.error.message ?? ""}`.trim();
        }
      }
    } catch {
      // not JSON
    }
    if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
      throw new Error(`Meta API POST ${res.status}: ${err}`);
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

export interface CreateAudienceResult {
  id: string;
}

/** Create an empty Custom Audience (subtype CUSTOM, customer-list source). */
export async function createCustomAudience(params: {
  accountId: string; // act_XXX
  name: string;
  description?: string;
}): Promise<CreateAudienceResult> {
  const API_VERSION = getApiVersion();
  const url = `https://graph.facebook.com/${API_VERSION}/${params.accountId}/customaudiences`;
  return metaPostJson<CreateAudienceResult>(url, {
    name: params.name,
    description: params.description ?? "",
    subtype: "CUSTOM",
    customer_file_source: "USER_PROVIDED_ONLY",
  });
}

/**
 * Upload hashed user data to a Custom Audience. Meta's batch size limit is
 * 10,000 users per call; we chunk automatically.
 */
export async function uploadEmailsToAudience(params: {
  audienceId: string;
  emails: string[]; // raw (we hash inside)
  log?: (m: string) => void;
}): Promise<{ uploadedCount: number; batches: number }> {
  const API_VERSION = getApiVersion();
  const log = params.log ?? ((m) => process.stderr.write(m + "\n"));
  const hashed = params.emails.map(hashEmailForMeta);

  const BATCH = 10_000;
  let uploaded = 0;
  let batches = 0;
  for (let i = 0; i < hashed.length; i += BATCH) {
    const chunk = hashed.slice(i, i + BATCH);
    const url = `https://graph.facebook.com/${API_VERSION}/${params.audienceId}/users`;
    await metaPostJson(url, {
      payload: {
        schema: "EMAIL_SHA256",
        data: chunk.map((h) => [h]),
      },
      session: {
        session_id: Date.now() + batches,
        batch_seq: batches + 1,
        last_batch_flag: i + BATCH >= hashed.length,
      },
    });
    batches++;
    uploaded += chunk.length;
    log(`  uploaded batch ${batches}: ${uploaded}/${hashed.length}`);
  }
  return { uploadedCount: uploaded, batches };
}

/** Create a 1% Lookalike from a seed Custom Audience. */
export async function createLookalike(params: {
  accountId: string;
  originAudienceId: string;
  name: string;
  ratio?: number; // 0.01 = 1%
  country?: string; // ISO 2-letter
}): Promise<CreateAudienceResult> {
  const API_VERSION = getApiVersion();
  const url = `https://graph.facebook.com/${API_VERSION}/${params.accountId}/customaudiences`;
  return metaPostJson<CreateAudienceResult>(url, {
    name: params.name,
    subtype: "LOOKALIKE",
    origin_audience_id: params.originAudienceId,
    lookalike_spec: JSON.stringify({
      type: "similarity",
      country: params.country ?? "US",
      ratio: params.ratio ?? 0.01,
    }),
  });
}

/**
 * Pause / activate an ad by id. Used by the cull-variants cron.
 */
export async function updateAdStatus(params: {
  adId: string;
  status: "ACTIVE" | "PAUSED";
}): Promise<{ success: true }> {
  const API_VERSION = getApiVersion();
  const url = `https://graph.facebook.com/${API_VERSION}/${params.adId}`;
  await metaPostJson(url, { status: params.status });
  return { success: true };
}

/**
 * Pause / activate any entity (ad, ad set, or campaign) by id. Generic
 * sibling of updateAdStatus — Meta accepts the same `status` field on all
 * three node types. Used by the MCP write tools.
 */
export async function updateEntityStatus(params: {
  id: string;
  status: "ACTIVE" | "PAUSED";
  accessToken?: string;
}): Promise<{ success: true }> {
  const API_VERSION = getApiVersion();
  await metaPostJson(
    `https://graph.facebook.com/${API_VERSION}/${params.id}`,
    { status: params.status },
    4,
    params.accessToken,
  );
  return { success: true };
}

/**
 * Set the daily budget on an ad set or campaign. Meta expects the budget in
 * the account's minor currency unit (cents for USD), as a string.
 */
export async function updateEntityDailyBudget(params: {
  id: string;
  dailyBudgetCents: number;
  accessToken?: string;
}): Promise<{ success: true }> {
  const API_VERSION = getApiVersion();
  await metaPostJson(
    `https://graph.facebook.com/${API_VERSION}/${params.id}`,
    { daily_budget: String(Math.round(params.dailyBudgetCents)) },
    4,
    params.accessToken,
  );
  return { success: true };
}

/**
 * Add a list of custom-audience IDs to an existing ad set's targeting,
 * preserving all other targeting fields. Uses a POST with `targeting` field
 * (the Marketing API's standard "replace targeting" endpoint — we read
 * existing first, merge, then write back).
 */
export async function addCustomAudiencesToAdSet(params: {
  adsetId: string;
  audienceIds: string[];
}): Promise<{ success: true }> {
  const API_VERSION = getApiVersion();

  // 1. Read existing targeting
  const existing = await metaFetchJson<{
    targeting?: Record<string, unknown> & {
      custom_audiences?: Array<{ id: string; name?: string }>;
    };
  }>(
    `https://graph.facebook.com/${API_VERSION}/${params.adsetId}?fields=targeting`,
    4,
  );
  const targeting = { ...(existing.targeting ?? {}) };
  const existingAudiences = Array.isArray(targeting.custom_audiences)
    ? targeting.custom_audiences
    : [];
  const merged = [
    ...existingAudiences.filter(
      (a) => !params.audienceIds.includes(a.id),
    ),
    ...params.audienceIds.map((id) => ({ id })),
  ];
  targeting.custom_audiences = merged;

  // 2. Write back
  const url = `https://graph.facebook.com/${API_VERSION}/${params.adsetId}`;
  await metaPostJson(url, { targeting });
  return { success: true };
}
