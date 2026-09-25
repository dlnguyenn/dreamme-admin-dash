/**
 * Ad breakdown · Meta access: the ad's creative and copy, its 14-day video
 * insights, and the served mp4. Verified 2026-09-25 on act_1575502753719515:
 *   - `/{video_id}?fields=source` returns error #10 for page-owned videos
 *     (every ad made from a post), so the fallback scrapes the mp4 out of
 *     the creative's preview iframe, which needs no login.
 *   - Meta's 3-second plays live in `actions[video_view]`; the per-second
 *     retention fields return null everywhere, so INSIGHT_FIELDS is all
 *     there is.
 */
import { INSIGHT_FIELDS, type RawInsights } from "./rubric";

const API_VERSION = process.env.META_API_VERSION ?? "v22.0";
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

export interface AdDetails {
  ad_id: string;
  name: string;
  status: string;
  adset: string;
  optimization_goal: string;
  campaign: string;
  objective: string;
  creative_id: string | null;
  video_id: string | null;
  thumbnail_url: string | null;
  primary_text: string | null;
  headline: string | null;
  cta: string | null;
}

async function graph<T>(token: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  const body = (await res.json()) as T & { error?: { message?: string; code?: number; error_subcode?: number } };
  if (body.error) {
    const e = body.error;
    // 190/459 is a Facebook checkpoint on the user account, not a token problem.
    const hint =
      e.code === 190 && e.error_subcode === 459
        ? " (Facebook wants the connected account to log in at facebook.com and clear a security checkpoint)"
        : "";
    throw new Error(`Meta ${path.split("?")[0]}: ${e.message ?? "unknown error"}${hint}`);
  }
  return body;
}

export async function fetchAdDetails(token: string, adId: string): Promise<AdDetails> {
  const j = await graph<{
    name?: string;
    effective_status?: string;
    adset?: { name?: string; optimization_goal?: string };
    campaign?: { name?: string; objective?: string };
    creative?: {
      id?: string;
      video_id?: string;
      thumbnail_url?: string;
      title?: string;
      body?: string;
      object_story_spec?: {
        video_data?: { video_id?: string; message?: string; title?: string; call_to_action?: { type?: string } };
      };
    };
  }>(token, adId, {
    fields:
      "name,effective_status,adset{name,optimization_goal},campaign{name,objective}," +
      "creative{id,video_id,thumbnail_url,title,body,object_story_spec}",
  });
  const cr = j.creative ?? {};
  const vd = cr.object_story_spec?.video_data ?? {};
  return {
    ad_id: adId,
    name: j.name ?? adId,
    status: j.effective_status ?? "",
    adset: j.adset?.name ?? "",
    optimization_goal: j.adset?.optimization_goal ?? "",
    campaign: j.campaign?.name ?? "",
    objective: j.campaign?.objective ?? "",
    creative_id: cr.id ?? null,
    video_id: cr.video_id ?? vd.video_id ?? null,
    thumbnail_url: cr.thumbnail_url ?? null,
    primary_text: vd.message ?? cr.body ?? null,
    headline: vd.title ?? cr.title ?? null,
    cta: vd.call_to_action?.type ?? null,
  };
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export async function fetchAdInsights(token: string, adId: string, days: number): Promise<RawInsights | null> {
  const j = await graph<{ data?: RawInsights[] }>(token, `${adId}/insights`, {
    fields: INSIGHT_FIELDS,
    time_range: JSON.stringify({ since: isoDaysAgo(days), until: isoDaysAgo(0) }),
  });
  return j.data?.[0] ?? null;
}

const UA = { "User-Agent": "Mozilla/5.0 (dreamme ad-breakdown)" };

async function download(url: string): Promise<{ bytes: Buffer; mime: string }> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`video download failed: HTTP ${res.status}`);
  const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "video/mp4";
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength < 10_000) throw new Error("video download returned no usable data");
  return { bytes, mime: mime.startsWith("video/") ? mime : "video/mp4" };
}

function unescapeHtml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** The served creative, HD rendition when the preview page offers one. */
export async function downloadAdVideo(
  token: string,
  det: AdDetails,
): Promise<{ bytes: Buffer; mime: string; how: "direct" | "preview" }> {
  if (det.video_id) {
    try {
      const v = await graph<{ source?: string }>(token, det.video_id, { fields: "source" });
      if (v.source) return { ...(await download(v.source)), how: "direct" };
    } catch {
      // page-owned video: fall through to the preview scrape
    }
  }
  if (!det.creative_id) throw new Error("ad has no creative id to preview");
  const p = await graph<{ data?: Array<{ body?: string }> }>(token, `${det.creative_id}/previews`, {
    ad_format: "MOBILE_FEED_STANDARD",
  });
  const iframeMatch = /src="([^"]+)"/.exec(p.data?.[0]?.body ?? "");
  if (!iframeMatch) throw new Error("creative preview returned no iframe");
  const page = await fetch(unescapeHtml(iframeMatch[1]), { headers: UA, signal: AbortSignal.timeout(60_000) });
  const html = (await page.text()).replace(/\\\//g, "/");
  const urls = [...new Set([...html.matchAll(/https:\/\/[^"'\s<>]+?\.mp4[^"'\s<>]*/g)].map((m) => unescapeHtml(m[0])))];
  if (urls.length === 0) throw new Error("no mp4 in the creative preview page");
  const sized = await Promise.all(
    urls.map(async (u) => {
      try {
        const h = await fetch(u, { method: "HEAD", headers: UA, signal: AbortSignal.timeout(30_000) });
        return { u, len: Number(h.headers.get("content-length") ?? 0) };
      } catch {
        return { u, len: 0 };
      }
    }),
  );
  sized.sort((a, b) => b.len - a.len);
  return { ...(await download(sized[0].u)), how: "preview" };
}
