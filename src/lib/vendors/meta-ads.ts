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
        error?: {
          message?: string;
          code?: number;
          type?: string;
          error_subcode?: number;
          error_user_title?: string;
          error_user_msg?: string;
        };
      };
      if (j.error) {
        if (j.error.code === 190) {
          err = `Token expired/invalid (code 190): ${j.error.message ?? ""}.`;
        } else {
          const detail = [
            j.error.error_subcode ? `subcode ${j.error.error_subcode}` : "",
            j.error.error_user_title ?? "",
            j.error.error_user_msg ?? "",
          ].filter(Boolean).join(" — ");
          err = `${j.error.code ?? "?"} ${j.error.type ?? ""} ${j.error.message ?? ""}${detail ? ` (${detail})` : ""}`.trim();
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
  accessToken?: string;
}): Promise<CreateAudienceResult> {
  const API_VERSION = getApiVersion();
  const url = `https://graph.facebook.com/${API_VERSION}/${params.accountId}/customaudiences`;
  return metaPostJson<CreateAudienceResult>(
    url,
    {
      name: params.name,
      description: params.description ?? "",
      subtype: "CUSTOM",
      customer_file_source: "USER_PROVIDED_ONLY",
    },
    4,
    params.accessToken,
  );
}

/**
 * Upload hashed user data to a Custom Audience. Meta's batch size limit is
 * 10,000 users per call; we chunk automatically.
 */
/**
 * Add already-hashed (SHA-256) emails to a Custom Audience. Core uploader — the
 * audience-sync pipeline works in hashes (it only ever persists hashed emails,
 * never raw PII). Chunked at Meta's 10k limit.
 */
export async function uploadEmailHashesToAudience(params: {
  audienceId: string;
  hashes: string[]; // already SHA-256-hashed
  log?: (m: string) => void;
  accessToken?: string;
}): Promise<{ uploadedCount: number; batches: number }> {
  const API_VERSION = getApiVersion();
  const log = params.log ?? ((m) => process.stderr.write(m + "\n"));
  const hashed = params.hashes;

  const BATCH = 10_000;
  let uploaded = 0;
  let batches = 0;
  for (let i = 0; i < hashed.length; i += BATCH) {
    const chunk = hashed.slice(i, i + BATCH);
    const url = `https://graph.facebook.com/${API_VERSION}/${params.audienceId}/users`;
    await metaPostJson(
      url,
      {
        payload: { schema: "EMAIL_SHA256", data: chunk.map((h) => [h]) },
        session: {
          session_id: Date.now() + batches,
          batch_seq: batches + 1,
          last_batch_flag: i + BATCH >= hashed.length,
        },
      },
      4,
      params.accessToken,
    );
    batches++;
    uploaded += chunk.length;
    log(`  uploaded batch ${batches}: ${uploaded}/${hashed.length}`);
  }
  return { uploadedCount: uploaded, batches };
}

/** Add raw emails to a Custom Audience (hashes, then delegates). */
export async function uploadEmailsToAudience(params: {
  audienceId: string;
  emails: string[]; // raw (we hash inside)
  log?: (m: string) => void;
  accessToken?: string;
}): Promise<{ uploadedCount: number; batches: number }> {
  return uploadEmailHashesToAudience({
    audienceId: params.audienceId,
    hashes: params.emails.map(hashEmailForMeta),
    log: params.log,
    accessToken: params.accessToken,
  });
}

/** Create a 1% Lookalike from a seed Custom Audience. */
export async function createLookalike(params: {
  accountId: string;
  originAudienceId: string;
  name: string;
  ratio?: number; // 0.01 = 1%
  country?: string; // ISO 2-letter
  accessToken?: string;
}): Promise<CreateAudienceResult> {
  const API_VERSION = getApiVersion();
  const url = `https://graph.facebook.com/${API_VERSION}/${params.accountId}/customaudiences`;
  return metaPostJson<CreateAudienceResult>(
    url,
    {
      name: params.name,
      subtype: "LOOKALIKE",
      origin_audience_id: params.originAudienceId,
      lookalike_spec: JSON.stringify({
        type: "similarity",
        country: params.country ?? "US",
        ratio: params.ratio ?? 0.01,
      }),
    },
    4,
    params.accessToken,
  );
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

// ---------------------------------------------------------------------------
// Duplication via the Graph /copies edge — "duplicate-to-graduate" winners.
// Copies default to PAUSED so a duplicate never silently spends.
// ---------------------------------------------------------------------------

type CopyStatusOption = "ACTIVE" | "PAUSED" | "INHERITED_FROM_SOURCE";

function renameOptions(suffix: string) {
  return { rename_strategy: "DEEP_RENAME", rename_suffix: suffix };
}

export interface CopyResult {
  copied_id: string;
  raw: Record<string, unknown>;
}

/** Duplicate a campaign (optionally its ad sets + ads). */
export async function copyCampaign(params: {
  campaignId: string;
  deepCopy?: boolean;
  statusOption?: CopyStatusOption;
  renameSuffix?: string;
  accessToken?: string;
}): Promise<CopyResult> {
  const API_VERSION = getApiVersion();
  const body = await metaPostJson<Record<string, unknown>>(
    `https://graph.facebook.com/${API_VERSION}/${params.campaignId}/copies`,
    {
      deep_copy: params.deepCopy ?? true,
      status_option: params.statusOption ?? "PAUSED",
      rename_options: renameOptions(params.renameSuffix ?? " - Copy"),
    },
    4,
    params.accessToken,
  );
  return { copied_id: String(body.copied_campaign_id ?? body.id ?? ""), raw: body };
}

/** Duplicate an ad set (optionally its ads), optionally into another campaign. */
export async function copyAdSet(params: {
  adsetId: string;
  targetCampaignId?: string;
  deepCopy?: boolean;
  statusOption?: CopyStatusOption;
  renameSuffix?: string;
  accessToken?: string;
}): Promise<CopyResult> {
  const API_VERSION = getApiVersion();
  const reqBody: Record<string, unknown> = {
    deep_copy: params.deepCopy ?? true,
    status_option: params.statusOption ?? "PAUSED",
    rename_options: renameOptions(params.renameSuffix ?? " - Copy"),
  };
  if (params.targetCampaignId) reqBody.campaign_id = params.targetCampaignId;
  const body = await metaPostJson<Record<string, unknown>>(
    `https://graph.facebook.com/${API_VERSION}/${params.adsetId}/copies`,
    reqBody,
    4,
    params.accessToken,
  );
  return { copied_id: String(body.copied_adset_id ?? body.id ?? ""), raw: body };
}

/** Duplicate an ad, optionally into another ad set. */
export async function copyAd(params: {
  adId: string;
  targetAdsetId?: string;
  statusOption?: CopyStatusOption;
  renameSuffix?: string;
  accessToken?: string;
}): Promise<CopyResult> {
  const API_VERSION = getApiVersion();
  const reqBody: Record<string, unknown> = {
    status_option: params.statusOption ?? "PAUSED",
    rename_options: renameOptions(params.renameSuffix ?? " - Copy"),
  };
  if (params.targetAdsetId) reqBody.adset_id = params.targetAdsetId;
  const body = await metaPostJson<Record<string, unknown>>(
    `https://graph.facebook.com/${API_VERSION}/${params.adId}/copies`,
    reqBody,
    4,
    params.accessToken,
  );
  return { copied_id: String(body.copied_ad_id ?? body.id ?? ""), raw: body };
}

// ---------------------------------------------------------------------------
// Creative building: upload a video, build an app-install VIDEO creative,
// create an ad. Mirrors the app-install spec in scripts/push-creative-variants.ts
// (which is image-based) but uses video_data. Used by batch_create_video_ads.
// ---------------------------------------------------------------------------

const DEFAULT_PAGE_ID = "935570636301545";
const DEFAULT_APP_LINK =
  "https://itunes.apple.com/WebObjects/MZStore.woa/wa/redirectToContent?id=6755569693";

const CREATIVE_FEATURES_OPT_OUT = {
  ads_with_benefits: { enroll_status: "OPT_OUT" },
  advantage_plus_creative: { enroll_status: "OPT_OUT" },
  image_animation: { enroll_status: "OPT_OUT" },
  image_templates: { enroll_status: "OPT_OUT" },
  product_extensions: { enroll_status: "OPT_OUT" },
  site_extensions: { enroll_status: "OPT_OUT" },
  text_optimizations: { enroll_status: "OPT_OUT" },
};

/** Upload a video to the ad account by URL. Returns the new video id. */
export async function uploadVideoByUrl(params: {
  accountId: string;
  fileUrl: string;
  name?: string;
  accessToken?: string;
}): Promise<string> {
  const API_VERSION = getApiVersion();
  const body: Record<string, unknown> = { file_url: params.fileUrl };
  if (params.name) body.name = params.name;
  const res = await metaPostJson<{ id?: string }>(
    `https://graph.facebook.com/${API_VERSION}/${params.accountId}/advideos`,
    body,
    4,
    params.accessToken,
  );
  if (!res.id) throw new Error("No video id returned from advideos upload");
  return res.id;
}

/** Poll a video until processing is ready (or errors / times out). */
export async function waitForVideoReady(params: {
  videoId: string;
  accessToken?: string;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<"ready" | "error" | "processing"> {
  const API_VERSION = getApiVersion();
  const deadline = Date.now() + (params.timeoutMs ?? 180_000);
  const poll = params.pollMs ?? 5_000;
  while (Date.now() < deadline) {
    const res = await metaFetchJson<{ status?: { video_status?: string } }>(
      `https://graph.facebook.com/${API_VERSION}/${params.videoId}?fields=status`,
      2,
      params.accessToken,
    );
    const s = res.status?.video_status;
    if (s === "ready") return "ready";
    if (s === "error") return "error";
    await sleep(poll);
  }
  return "processing"; // timed out, still processing
}

/** Best thumbnail URI for a processed video (preferred, else first). */
export async function getVideoThumbnail(params: {
  videoId: string;
  accessToken?: string;
}): Promise<string | null> {
  const API_VERSION = getApiVersion();
  try {
    const res = await metaFetchJson<{ data?: Array<{ uri?: string; is_preferred?: boolean }> }>(
      `https://graph.facebook.com/${API_VERSION}/${params.videoId}/thumbnails?fields=uri,is_preferred`,
      2,
      params.accessToken,
    );
    const thumbs = res.data ?? [];
    return (thumbs.find((t) => t.is_preferred)?.uri ?? thumbs[0]?.uri) ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch an image by URL and upload it to the ad account, returning its
 * image_hash. Used to turn a video's auto-generated thumbnail into a hash that
 * video_data accepts (Meta rejects a raw CDN thumbnail URL as image_url).
 * Mirrors the adimages upload in scripts/push-creative-variants.ts.
 */
export async function uploadImageByUrl(params: {
  accountId: string;
  imageUrl: string;
  accessToken?: string;
}): Promise<string> {
  const TOKEN = params.accessToken ?? getToken();
  if (!TOKEN) throw new Error("META_ACCESS_TOKEN not set");
  const API_VERSION = getApiVersion();
  const imgRes = await fetch(params.imageUrl, { cache: "no-store" });
  if (!imgRes.ok) throw new Error(`thumbnail fetch failed: ${imgRes.status}`);
  const bytes = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
  const form = new URLSearchParams({ bytes });
  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${params.accountId}/adimages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      cache: "no-store",
    },
  );
  const j = (await res.json()) as { images?: Record<string, { hash?: string }> };
  if (!res.ok) throw new Error(`adimages upload failed: ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
  const hash = Object.values(j.images ?? {})[0]?.hash;
  if (!hash) throw new Error("no image_hash returned from adimages");
  return hash;
}

/**
 * Build an app-install VIDEO creative. Returns the new creative id.
 * Meta requires a thumbnail for video_data — pass an image_hash (from
 * uploadImageByUrl on the video's auto thumbnail).
 */
export async function createVideoCreative(params: {
  accountId: string;
  name: string;
  videoId: string;
  imageHash: string;
  message: string;
  headline?: string;
  link?: string;
  pageId?: string;
  /** UTM query string (no leading ?) appended by Meta to the landing link. */
  urlTags?: string;
  accessToken?: string;
}): Promise<string> {
  const API_VERSION = getApiVersion();
  const videoData: Record<string, unknown> = {
    video_id: params.videoId,
    image_hash: params.imageHash,
    message: params.message,
    call_to_action: {
      type: "INSTALL_MOBILE_APP",
      value: { link: params.link ?? DEFAULT_APP_LINK },
    },
  };
  if (params.headline) videoData.title = params.headline;
  const creativeBody: Record<string, unknown> = {
    name: params.name,
    object_story_spec: { page_id: params.pageId ?? DEFAULT_PAGE_ID, video_data: videoData },
    degrees_of_freedom_spec: { creative_features_spec: CREATIVE_FEATURES_OPT_OUT },
  };
  if (params.urlTags) creativeBody.url_tags = params.urlTags;
  const res = await metaPostJson<{ id?: string }>(
    `https://graph.facebook.com/${API_VERSION}/${params.accountId}/adcreatives`,
    creativeBody,
    4,
    params.accessToken,
  );
  if (!res.id) throw new Error("No creative id returned from adcreatives");
  return res.id;
}

/**
 * Read the creative essentials off existing ads — enough to REBUILD each ad as
 * a fresh creative (same uploaded video, same copy) when Meta's dev-mode-app
 * restriction (subcode 1885183) blocks /copies of the original post.
 */
type AdCreativeInfoRow = {
  ad_id: string;
  ad_name: string | null;
  effective_status: string | null;
  creative_id: string | null;
  /** The underlying post (page_id_post_id). Social proof (likes/comments) lives
   *  here — copies that share this id share the engagement. */
  object_story_id: string | null;
  video_id: string | null;
  message: string | null;
  headline: string | null;
  link: string | null;
  page_id: string | null;
  /** The app that authored the underlying post — the one Meta checks for the
   *  dev-mode-app block (1885183). Null if the post has no application or the
   *  lookup wasn't permitted. */
  authoring_app_id: string | null;
  authoring_app_name: string | null;
  /** Policy issues when the ad is disapproved (from issues_info). */
  issues: Array<{ code?: number; summary?: string; message?: string; level?: string }> | null;
  /** Detailed review verdict (from ad_review_feedback) — often where the real
   *  disapproval reason lives when issues_info is empty. */
  review_feedback: Record<string, unknown> | null;
  error?: string;
};

export async function fetchAdCreativeInfo(params: {
  adIds: string[];
  accessToken?: string;
}): Promise<AdCreativeInfoRow[]> {
  const API_VERSION = getApiVersion();
  const out: AdCreativeInfoRow[] = [];
  for (const adId of params.adIds) {
    try {
      const res = await metaFetchJson<{
        id?: string;
        name?: string;
        effective_status?: string;
        issues_info?: Array<{ error_code?: number; error_summary?: string; error_message?: string; level?: string }>;
        ad_review_feedback?: Record<string, unknown>;
        creative?: {
          id?: string;
          video_id?: string;
          effective_object_story_id?: string;
          object_story_spec?: {
            page_id?: string;
            video_data?: {
              video_id?: string;
              message?: string;
              title?: string;
              call_to_action?: { value?: { link?: string } };
            };
          };
        };
      }>(
        `https://graph.facebook.com/${API_VERSION}/${adId}?fields=id,name,effective_status,issues_info,ad_review_feedback,creative{id,video_id,effective_object_story_id,object_story_spec}`,
        3,
        params.accessToken,
      );
      const oss = res.creative?.object_story_spec;
      const issues = (res.issues_info ?? []).map((i) => ({
        code: i.error_code,
        summary: i.error_summary,
        message: i.error_message,
        level: i.level,
      }));
      // Best-effort: read the authoring app off the underlying post. This is the
      // app whose dev/live mode Meta checks when you reuse the post in a new ad.
      let appId: string | null = null;
      let appName: string | null = null;
      const storyId = res.creative?.effective_object_story_id;
      if (storyId) {
        try {
          const post = await metaFetchJson<{ application?: { id?: string; name?: string } }>(
            `https://graph.facebook.com/${API_VERSION}/${storyId}?fields=application{id,name}`,
            2,
            params.accessToken,
          );
          appId = post.application?.id ?? null;
          appName = post.application?.name ?? null;
        } catch {
          // post may not expose application to this token — leave null
        }
      }
      out.push({
        ad_id: adId,
        ad_name: res.name ?? null,
        effective_status: res.effective_status ?? null,
        creative_id: res.creative?.id ?? null,
        object_story_id: res.creative?.effective_object_story_id ?? null,
        video_id: res.creative?.video_id ?? oss?.video_data?.video_id ?? null,
        message: oss?.video_data?.message ?? null,
        headline: oss?.video_data?.title ?? null,
        link: oss?.video_data?.call_to_action?.value?.link ?? null,
        page_id: oss?.page_id ?? null,
        authoring_app_id: appId,
        authoring_app_name: appName,
        issues: issues.length ? issues : null,
        review_feedback: res.ad_review_feedback ?? null,
      });
    } catch (e) {
      out.push({
        ad_id: adId,
        ad_name: null,
        effective_status: null,
        creative_id: null,
        object_story_id: null,
        video_id: null,
        message: null,
        headline: null,
        link: null,
        page_id: null,
        authoring_app_id: null,
        authoring_app_name: null,
        issues: null,
        review_feedback: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

/** Create an ad in an ad set from an existing creative. Returns the new ad id. */
export async function createAd(params: {
  accountId: string;
  adsetId: string;
  name: string;
  creativeId: string;
  status?: "ACTIVE" | "PAUSED";
  accessToken?: string;
}): Promise<string> {
  const API_VERSION = getApiVersion();
  const res = await metaPostJson<{ id?: string }>(
    `https://graph.facebook.com/${API_VERSION}/${params.accountId}/ads`,
    {
      name: params.name,
      adset_id: params.adsetId,
      creative: { creative_id: params.creativeId },
      status: params.status ?? "PAUSED",
    },
    4,
    params.accessToken,
  );
  if (!res.id) throw new Error("No ad id returned from ads create");
  return res.id;
}

/**
 * Create an ad creative that references an EXISTING page post via
 * object_story_id ("Use Existing Post"). Unlike /copies (which clones the post
 * into a new zero-engagement post) this keeps the ad on the ORIGINAL post, so
 * it inherits the post's accumulated likes/comments/shares. url_tags rides
 * along without forking the post. Returns the new creative id.
 */
export async function createExistingPostCreative(params: {
  accountId: string;
  name: string;
  objectStoryId: string;
  urlTags?: string;
  accessToken?: string;
}): Promise<string> {
  const API_VERSION = getApiVersion();
  const body: Record<string, unknown> = {
    name: params.name,
    object_story_id: params.objectStoryId,
  };
  if (params.urlTags) body.url_tags = params.urlTags;
  const res = await metaPostJson<{ id?: string }>(
    `https://graph.facebook.com/${API_VERSION}/${params.accountId}/adcreatives`,
    body,
    4,
    params.accessToken,
  );
  if (!res.id) throw new Error("No creative id returned from adcreatives (existing post)");
  return res.id;
}

/** Read one ad's underlying post id (effective_object_story_id). */
export async function getAdObjectStoryId(params: {
  adId: string;
  accessToken?: string;
}): Promise<string | null> {
  const API_VERSION = getApiVersion();
  const res = await metaFetchJson<{ creative?: { effective_object_story_id?: string } }>(
    `https://graph.facebook.com/${API_VERSION}/${params.adId}?fields=creative{effective_object_story_id}`,
    3,
    params.accessToken,
  );
  return res.creative?.effective_object_story_id ?? null;
}

/**
 * Permanently delete an entity (campaign / ad set / ad / creative / video) by
 * id via Graph HTTP DELETE. Irreversible. Token-injectable.
 */
export async function deleteEntity(params: {
  id: string;
  accessToken?: string;
}): Promise<{ success: boolean }> {
  const TOKEN = params.accessToken ?? getToken();
  if (!TOKEN) throw new Error("META_ACCESS_TOKEN not set");
  const API_VERSION = getApiVersion();
  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${params.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: { code?: number; message?: string; error_user_msg?: string };
  };
  if (!res.ok) {
    const e = j.error;
    throw new Error(
      `Meta API DELETE ${res.status}: ${e ? `${e.code ?? "?"} ${e.message ?? ""}${e.error_user_msg ? ` (${e.error_user_msg})` : ""}` : JSON.stringify(j).slice(0, 200)}`,
    );
  }
  return { success: j.success ?? true };
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
  accessToken?: string;
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
    params.accessToken,
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
  await metaPostJson(url, { targeting }, 4, params.accessToken);
  return { success: true };
}

/**
 * Remove already-hashed emails from a Custom Audience (DELETE /{audience}/users).
 * Core remover — keeps the suppression audience == current active subscribers
 * (drop churned) and the win-back audience clean (drop re-activated). Chunked 10k.
 */
export async function removeEmailHashesFromAudience(params: {
  audienceId: string;
  hashes: string[]; // already SHA-256-hashed
  log?: (m: string) => void;
  accessToken?: string;
}): Promise<{ removedCount: number; batches: number }> {
  const API_VERSION = getApiVersion();
  const log = params.log ?? ((m) => process.stderr.write(m + "\n"));
  const TOKEN = params.accessToken ?? getToken();
  if (!TOKEN) throw new Error("META_ACCESS_TOKEN not set");
  const hashed = params.hashes;
  const BATCH = 10_000;
  let removed = 0;
  let batches = 0;
  for (let i = 0; i < hashed.length; i += BATCH) {
    const chunk = hashed.slice(i, i + BATCH);
    const url = `https://graph.facebook.com/${API_VERSION}/${params.audienceId}/users`;
    const body = { payload: { schema: "EMAIL_SHA256", data: chunk.map((h) => [h]) } };
    const res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Meta audience user-remove ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    batches++;
    removed += chunk.length;
    log(`  removed batch ${batches}: ${removed}/${hashed.length}`);
  }
  return { removedCount: removed, batches };
}

/** Remove raw emails from a Custom Audience (hashes, then delegates). */
export async function removeEmailsFromAudience(params: {
  audienceId: string;
  emails: string[]; // raw (we hash inside)
  log?: (m: string) => void;
  accessToken?: string;
}): Promise<{ removedCount: number; batches: number }> {
  return removeEmailHashesFromAudience({
    audienceId: params.audienceId,
    hashes: params.emails.map(hashEmailForMeta),
    log: params.log,
    accessToken: params.accessToken,
  });
}

/**
 * Set (merge) excluded custom audiences on an ad set's targeting, preserving
 * other targeting fields. This is the suppression attach — it stops prospecting
 * from re-acquiring users already in the audience (e.g. current subscribers).
 */
export async function setExcludedAudiencesOnAdSet(params: {
  adsetId: string;
  excludedAudienceIds: string[];
  accessToken?: string;
}): Promise<{ success: true }> {
  const API_VERSION = getApiVersion();
  const existing = await metaFetchJson<{
    targeting?: Record<string, unknown> & {
      excluded_custom_audiences?: Array<{ id: string; name?: string }>;
    };
  }>(
    `https://graph.facebook.com/${API_VERSION}/${params.adsetId}?fields=targeting`,
    4,
    params.accessToken,
  );
  const targeting = { ...(existing.targeting ?? {}) };
  const current = Array.isArray(targeting.excluded_custom_audiences)
    ? targeting.excluded_custom_audiences
    : [];
  targeting.excluded_custom_audiences = [
    ...current.filter((a) => !params.excludedAudienceIds.includes(a.id)),
    ...params.excludedAudienceIds.map((id) => ({ id })),
  ];
  await metaPostJson(
    `https://graph.facebook.com/${API_VERSION}/${params.adsetId}`,
    { targeting },
    4,
    params.accessToken,
  );
  return { success: true };
}

export interface ProspectingAdSet {
  id: string;
  name: string;
  campaignId: string;
  campaignName: string;
  objective: string;
}

// App-promotion objectives across ODAX + legacy naming.
const APP_PROMO_OBJECTIVES = new Set([
  "OUTCOME_APP_PROMOTION",
  "APP_INSTALLS",
  "MOBILE_APP_INSTALLS",
]);

/**
 * Discover ACTIVE ad sets in ACTIVE app-promotion campaigns — the prospecting
 * surface the suppression audience should be excluded from. (Best-effort: Meta
 * doesn't expose a "prospecting" flag, so we approximate as active app-promo
 * delivery.)
 */
export async function getActiveProspectingAdSets(params: {
  accountId: string;
  accessToken?: string;
}): Promise<ProspectingAdSet[]> {
  const API_VERSION = getApiVersion();
  const out: ProspectingAdSet[] = [];
  let url: string | null =
    `https://graph.facebook.com/${API_VERSION}/${params.accountId}/adsets` +
    `?fields=id,name,effective_status,campaign{id,name,objective,effective_status}&limit=200`;
  while (url) {
    const page: {
      data?: Array<{
        id: string;
        name: string;
        effective_status: string;
        campaign?: { id: string; name: string; objective: string; effective_status: string };
      }>;
      paging?: { next?: string };
    } = await metaFetchJson(url, 4, params.accessToken);
    for (const a of page.data ?? []) {
      if (a.effective_status !== "ACTIVE") continue;
      const c = a.campaign;
      if (!c || c.effective_status !== "ACTIVE") continue;
      if (!APP_PROMO_OBJECTIVES.has(c.objective)) continue;
      out.push({ id: a.id, name: a.name, campaignId: c.id, campaignName: c.name, objective: c.objective });
    }
    url = page.paging?.next ?? null;
  }
  return out;
}
