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
): Promise<T> {
  const TOKEN = getToken();
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
}): Promise<AdInsightRow[]> {
  const TOKEN = getToken();
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
    const body = await metaFetchJson<AdsResponse>(adsUrl, maxRetries);
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
    }>(insightsUrl, maxRetries);

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
      });
    }

    if (!body.paging?.next) break;
    insightsUrl = body.paging.next;
  }

  return out;
}
