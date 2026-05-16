/**
 * TikTok Marketing API client (bare fetch, no SDK).
 *
 * Mirrors meta-ads.ts retry/backoff pattern. Reads env lazily inside
 * functions so loadEnvConfig in CLI scripts works.
 *
 * Auth: `Access-Token: <token>` header. v1.3 API.
 *
 * Important field-name renames (TikTok ↔ Meta):
 *   cost                 ↔ spend
 *   real_time_app_install ↔ installs
 *   start_trial          ↔ trial_starts
 *   purchase             ↔ purchases
 *   total_purchase_value ↔ purchase_value
 *   identity_type=AUTH_CODE ↔ Spark Ad (boosted creator post)
 */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const BASE_URL = "https://business-api.tiktok.com/open_api/v1.3";

function getToken(): string {
  return process.env.TIKTOK_ADS_ACCESS_TOKEN ?? "";
}
function getAdvertiserId(): string {
  return process.env.TIKTOK_ADVERTISER_ID ?? "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function tiktokAdsConfigured(): boolean {
  return !!getToken() && !!getAdvertiserId();
}

interface TtResponse<T> {
  code?: number;
  message?: string;
  request_id?: string;
  data?: T;
}

async function ttFetchJson<T>(
  url: string,
  maxRetries: number,
): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("TIKTOK_ADS_ACCESS_TOKEN not set");
  const headers = {
    "Access-Token": token,
    "Content-Type": "application/json",
    accept: "application/json",
  };
  let attempt = 0;
  while (true) {
    const res = await fetch(url, { headers, cache: "no-store" });
    if (res.ok) {
      const body = (await res.json()) as TtResponse<T>;
      // TikTok returns 200 with code 0 on success; non-zero codes are
      // application errors (auth, throttle, bad params, etc.).
      if (body.code !== undefined && body.code !== 0) {
        // 40100 / 40101 = auth; 41xxx = client error; 50xxx = server.
        const retryable =
          body.code >= 50000 || body.code === 40104 || body.code === 40016;
        if (!retryable || attempt >= maxRetries) {
          throw new Error(
            `TikTok API error: code ${body.code} ${body.message ?? ""}`,
          );
        }
        const backoff = Math.min(32_000, 1000 * Math.pow(2, attempt));
        await sleep(backoff + Math.floor(Math.random() * 250));
        attempt++;
        continue;
      }
      return (body.data ?? {}) as T;
    }
    const text = await res.text();
    if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
      throw new Error(`TikTok API error: ${res.status} ${text.slice(0, 200)}`);
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

interface ReportRow {
  dimensions?: { ad_id?: string; stat_time_day?: string };
  metrics?: Record<string, string | number>;
}

interface ReportData {
  list?: ReportRow[];
  page_info?: {
    page?: number;
    total_page?: number;
    total_number?: number;
  };
}

interface AdMetaRow {
  ad_id?: string;
  ad_name?: string;
  adgroup_id?: string;
  adgroup_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  operation_status?: string;
  status?: string;
  identity_id?: string;
  identity_type?: string;
  tiktok_item_id?: string;
  video_id?: string;
  image_ids?: string[];
}

interface AdListData {
  list?: AdMetaRow[];
  page_info?: {
    page?: number;
    total_page?: number;
    total_number?: number;
  };
}

interface IdentityInfo {
  identity_id?: string;
  identity_type?: string;
  display_name?: string;
  username?: string;
  avatar_url?: string;
}

interface IdentityListData {
  identity_list?: IdentityInfo[];
}

interface VideoInfo {
  video_id?: string;
  video_cover_url?: string;
  poster_url?: string;
}

interface VideoListData {
  list?: VideoInfo[];
}

export interface TikTokAdInsightRow {
  ad_id: string;
  date: string;
  ad_name: string;
  adgroup_id: string;
  adgroup_name: string;
  campaign_id: string;
  campaign_name: string;
  status: string;
  operation_status: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpm: number | null;
  video_play_actions: number;
  video_views_p100: number;
  installs: number;
  trial_starts: number;
  purchases: number;
  purchase_value: number;
  is_spark_ad: boolean;
  spark_creator_username: string;
  spark_video_id: string;
  spark_video_url: string;
  thumbnail_url: string;
}

/**
 * Fetch ad-level TikTok insights for a date range, joined with ad meta
 * (status, creative identity) and Spark Ad detection.
 */
export async function fetchTikTokAdInsights(params: {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  maxRetries?: number;
}): Promise<TikTokAdInsightRow[]> {
  const advertiserId = getAdvertiserId();
  if (!advertiserId) throw new Error("TIKTOK_ADVERTISER_ID not set");
  const maxRetries = params.maxRetries ?? 4;

  // 1. Pull ad-level insights with daily breakdown.
  const metrics = [
    "cost",
    "impressions",
    "clicks",
    "ctr",
    "cpm",
    "video_play_actions",
    "video_views_p100",
    "real_time_app_install",
    "start_trial",
    "purchase",
    "total_purchase_value",
    "ad_name",
    "adgroup_id",
    "adgroup_name",
    "campaign_id",
    "campaign_name",
  ];

  const allRows: ReportRow[] = [];
  let page = 1;
  while (true) {
    const qs = new URLSearchParams({
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: "AUCTION_AD",
      dimensions: JSON.stringify(["ad_id", "stat_time_day"]),
      metrics: JSON.stringify(metrics),
      start_date: params.startDate,
      end_date: params.endDate,
      page: String(page),
      page_size: "1000",
    });
    const url = `${BASE_URL}/report/integrated/get/?${qs.toString()}`;
    const data = await ttFetchJson<ReportData>(url, maxRetries);
    const rows = data.list ?? [];
    allRows.push(...rows);
    const totalPage = data.page_info?.total_page ?? 1;
    if (page >= totalPage || !rows.length) break;
    page++;
  }

  if (allRows.length === 0) return [];

  // 2. Pull ad meta (identity_type tells us if it's a Spark Ad).
  const adIds = Array.from(
    new Set(
      allRows.map((r) => r.dimensions?.ad_id).filter(Boolean) as string[],
    ),
  );
  const metaMap = new Map<string, AdMetaRow>();
  // /ad/get/ supports filtering by ad_ids in batches of 100.
  for (let i = 0; i < adIds.length; i += 100) {
    const batch = adIds.slice(i, i + 100);
    const qs = new URLSearchParams({
      advertiser_id: advertiserId,
      filtering: JSON.stringify({ ad_ids: batch }),
      fields: JSON.stringify([
        "ad_id",
        "ad_name",
        "adgroup_id",
        "adgroup_name",
        "campaign_id",
        "campaign_name",
        "operation_status",
        "status",
        "identity_id",
        "identity_type",
        "tiktok_item_id",
        "video_id",
        "image_ids",
      ]),
      page: "1",
      page_size: "100",
    });
    const url = `${BASE_URL}/ad/get/?${qs.toString()}`;
    const data = await ttFetchJson<AdListData>(url, maxRetries);
    for (const ad of data.list ?? []) {
      if (ad.ad_id) metaMap.set(ad.ad_id, ad);
    }
  }

  // 3. For Spark Ads, look up creator username via /identity/info/.
  // identity_type values: CUSTOMIZED_USER, AUTHORIZED_BC_ACCOUNT, AUTH_CODE
  //   (AUTH_CODE === Spark Ad, content owned by a creator who granted auth)
  const sparkIdentityIds = Array.from(
    new Set(
      [...metaMap.values()]
        .filter((m) => m.identity_type === "AUTH_CODE" && m.identity_id)
        .map((m) => m.identity_id!) as string[],
    ),
  );
  const identityMap = new Map<string, IdentityInfo>();
  for (const identityId of sparkIdentityIds) {
    try {
      const qs = new URLSearchParams({
        advertiser_id: advertiserId,
        identity_id: identityId,
        identity_type: "AUTH_CODE",
      });
      const url = `${BASE_URL}/identity/info/?${qs.toString()}`;
      const data = await ttFetchJson<IdentityListData>(url, maxRetries);
      const info = data.identity_list?.[0];
      if (info) identityMap.set(identityId, info);
    } catch {
      // Per-identity lookup failure shouldn't tank the whole sync.
    }
  }

  // 4. Video thumbnails for the ads that have a video_id.
  const videoIds = Array.from(
    new Set(
      [...metaMap.values()]
        .map((m) => m.video_id)
        .filter(Boolean) as string[],
    ),
  );
  const thumbMap = new Map<string, string>();
  for (let i = 0; i < videoIds.length; i += 100) {
    const batch = videoIds.slice(i, i + 100);
    try {
      const qs = new URLSearchParams({
        advertiser_id: advertiserId,
        video_ids: JSON.stringify(batch),
      });
      const url = `${BASE_URL}/file/video/ad/info/?${qs.toString()}`;
      const data = await ttFetchJson<VideoListData>(url, maxRetries);
      for (const v of data.list ?? []) {
        if (v.video_id && (v.poster_url || v.video_cover_url)) {
          thumbMap.set(v.video_id, v.poster_url ?? v.video_cover_url ?? "");
        }
      }
    } catch {
      // Don't fail sync on thumbnail issues.
    }
  }

  // 5. Stitch insights + meta + identity + thumb.
  const out: TikTokAdInsightRow[] = [];
  for (const row of allRows) {
    const adId = row.dimensions?.ad_id ?? "";
    const date = row.dimensions?.stat_time_day ?? "";
    if (!adId || !date) continue;
    const meta = metaMap.get(adId);
    const identity =
      meta?.identity_id ? identityMap.get(meta.identity_id) : undefined;
    const m = row.metrics ?? {};
    const isSpark = meta?.identity_type === "AUTH_CODE";
    const creatorUsername = identity?.username ?? identity?.display_name ?? "";
    const sparkVideoId = meta?.tiktok_item_id ?? meta?.video_id ?? "";
    const sparkVideoUrl =
      isSpark && creatorUsername && sparkVideoId
        ? `https://www.tiktok.com/@${creatorUsername}/video/${sparkVideoId}`
        : "";
    const videoIdForThumb = meta?.video_id ?? "";
    const thumbnail = thumbMap.get(videoIdForThumb) ?? "";

    // Normalize date — TikTok returns "YYYY-MM-DD HH:MM:SS" sometimes.
    const dateOnly = date.slice(0, 10);

    out.push({
      ad_id: adId,
      date: dateOnly,
      ad_name: String(m.ad_name ?? meta?.ad_name ?? ""),
      adgroup_id: String(m.adgroup_id ?? meta?.adgroup_id ?? ""),
      adgroup_name: String(m.adgroup_name ?? meta?.adgroup_name ?? ""),
      campaign_id: String(m.campaign_id ?? meta?.campaign_id ?? ""),
      campaign_name: String(m.campaign_name ?? meta?.campaign_name ?? ""),
      status: String(meta?.status ?? ""),
      operation_status: String(meta?.operation_status ?? ""),
      spend: Number(m.cost ?? 0),
      impressions: Number(m.impressions ?? 0),
      clicks: Number(m.clicks ?? 0),
      ctr: m.ctr !== undefined ? Number(m.ctr) : null,
      cpm: m.cpm !== undefined ? Number(m.cpm) : null,
      video_play_actions: Number(m.video_play_actions ?? 0),
      video_views_p100: Number(m.video_views_p100 ?? 0),
      installs: Number(m.real_time_app_install ?? 0),
      trial_starts: Number(m.start_trial ?? 0),
      purchases: Number(m.purchase ?? 0),
      purchase_value: Number(m.total_purchase_value ?? 0),
      is_spark_ad: isSpark,
      spark_creator_username: creatorUsername,
      spark_video_id: sparkVideoId,
      spark_video_url: sparkVideoUrl,
      thumbnail_url: thumbnail,
    });
  }

  return out;
}
