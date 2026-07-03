/**
 * Competitor Ad Tracker — pull a competitor's Meta Ad Library ads via the
 * ScrapeCreators API, AI-analyze each new ad (format / angle / hook /
 * offer / why notable), and diff against what we've already seen so new
 * launches surface as "NEW" and disappeared ads get marked ended.
 *
 * Same architecture as viral-apps.ts: anon reads, service-role writes,
 * Haiku structuredCall for analysis, covers re-hosted to our bucket.
 *
 * API (verified against the local MCP source + a 100-ad MeAgain sample):
 *   GET /v1/facebook/adLibrary/search/companies?query=…     (x-api-key)
 *   GET /v1/facebook/adLibrary/company/ads?pageId=…&trim=false[&cursor=…]
 */
import { z } from "zod";
import { fetchToStorage } from "@/lib/storage";
import { structuredCall } from "@/lib/growth-tools";

const SC_BASE = "https://api.scrapecreators.com/v1/facebook/adLibrary";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const HAIKU = "claude-haiku-4-5-20251001";
/** Max ads pulled per brand per scrape (pagination cap). */
const MAX_ADS_PER_BRAND = 150;
/** Cost guard: max NEW ads analyzed per run. */
const MAX_ANALYZE_PER_RUN = 40;
const ANALYZE_CONCURRENCY = 3;

export const NO_SC_KEY =
  "SCRAPECREATORS_API_KEY not set — add it to .env.local / Vercel env to enable competitor tracking.";

function scKey(): string {
  return process.env.SCRAPECREATORS_API_KEY ?? "";
}

export function scConfigured(): boolean {
  return !!scKey();
}

// --- Supabase helpers (same idiom as viral-apps.ts) ---------------------------

async function sbSelect<T>(path: string): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON) throw new Error("Supabase not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase read failed (${path.split("?")[0]}): ${res.status}`);
  return (await res.json()) as T[];
}

async function sbWrite(method: "POST" | "PATCH", path: string, body: unknown): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("service role not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "resolution=merge-duplicates,return=minimal" : "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase write failed (${path.split("?")[0]}): ${res.status} ${await res.text()}`);
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchImageBase64(url: string): Promise<{ data: string; mime: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    return { data: buf.toString("base64"), mime };
  } catch {
    return null;
  }
}

// --- ScrapeCreators calls -------------------------------------------------------

async function scGet(path: string, params: Record<string, string>): Promise<unknown> {
  const key = scKey();
  if (!key) throw new Error(NO_SC_KEY);
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${SC_BASE}/${path}?${qs}`, {
    headers: { "x-api-key": key },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`ScrapeCreators ${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

export interface BrandCandidate {
  page_id: string;
  name: string;
  category: string | null;
  likes: number | null;
  verification: string | null;
  image_uri: string | null;
}

const SearchResultSchema = z
  .object({
    page_id: z.union([z.string(), z.number()]).optional(),
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string().optional(),
    category: z.string().nullable().optional(),
    likes: z.number().nullable().optional(),
    verification: z.string().nullable().optional(),
    image_uri: z.string().nullable().optional(),
  })
  .passthrough();

export async function searchCompanies(query: string): Promise<BrandCandidate[]> {
  const raw = (await scGet("search/companies", { query })) as { searchResults?: unknown[] };
  const out: BrandCandidate[] = [];
  for (const r of raw.searchResults ?? []) {
    const parsed = SearchResultSchema.safeParse(r);
    if (!parsed.success) continue;
    const d = parsed.data;
    const pageId = d.page_id ?? d.id;
    if (pageId == null || !d.name) continue;
    out.push({
      page_id: String(pageId),
      name: d.name,
      category: d.category ?? null,
      likes: d.likes ?? null,
      verification: d.verification ?? null,
      image_uri: d.image_uri ?? null,
    });
  }
  return out.slice(0, 10);
}

// --- ad parsing / normalization ---------------------------------------------------
// Field names pinned against the real 100-ad MeAgain sample:
//   body is {text}, platforms key is `publisher_platform`, video thumbnails
//   are videos[0].video_preview_image_url, and collapsed variants can have
//   display_format null with NO media at all (copy-only analysis then).

const RawAdSchema = z
  .object({
    ad_archive_id: z.union([z.string(), z.number()]),
    page_id: z.union([z.string(), z.number()]).optional(),
    page_name: z.string().nullable().optional(),
    is_active: z.boolean().optional(),
    start_date: z.number().nullable().optional(),
    end_date: z.number().nullable().optional(),
    publisher_platform: z.array(z.string()).nullable().optional(),
    ad_library_url: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    snapshot: z
      .object({
        display_format: z.string().nullable().optional(),
        body: z.object({ text: z.string().nullable().optional() }).passthrough().nullable().optional(),
        title: z.string().nullable().optional(),
        cta_text: z.string().nullable().optional(),
        cta_type: z.string().nullable().optional(),
        link_url: z.string().nullable().optional(),
        images: z
          .array(z.object({ resized_image_url: z.string().nullable().optional() }).passthrough())
          .nullable()
          .optional(),
        cards: z
          .array(
            z
              .object({
                resized_image_url: z.string().nullable().optional(),
                body: z.string().nullable().optional(),
              })
              .passthrough(),
          )
          .nullable()
          .optional(),
        videos: z
          .array(
            z
              .object({
                video_preview_image_url: z.string().nullable().optional(),
                video_sd_url: z.string().nullable().optional(),
              })
              .passthrough(),
          )
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export interface NormalizedAd {
  adArchiveId: string;
  pageId: string;
  pageName: string | null;
  isActive: boolean;
  startedAtISO: string | null;
  endedAtISO: string | null;
  mediaType: "image" | "video" | "dco" | "unknown";
  mediaUrl: string | null;
  /** Best still image for analysis + re-hosting (null → copy-only). */
  coverUrl: string | null;
  body: string;
  title: string | null;
  ctaText: string | null;
  ctaType: string | null;
  linkUrl: string | null;
  adLibraryUrl: string;
  platforms: string[];
}

function unixToISO(v: number | null | undefined): string | null {
  return typeof v === "number" && v > 0 ? new Date(v * 1000).toISOString() : null;
}

export function normalizeAd(raw: unknown, fallbackPageId: string): NormalizedAd | null {
  const parsed = RawAdSchema.safeParse(raw);
  if (!parsed.success) return null;
  const a = parsed.data;
  const s = a.snapshot ?? {};
  const adArchiveId = String(a.ad_archive_id);

  const video = s.videos?.[0];
  const image = s.images?.[0];
  const card = s.cards?.[0];

  const fmt = (s.display_format ?? "").toUpperCase();
  const mediaType: NormalizedAd["mediaType"] = video
    ? "video"
    : fmt === "VIDEO"
      ? "video"
      : fmt === "DCO" || (s.cards?.length ?? 0) > 0
        ? "dco"
        : fmt === "IMAGE" || image
          ? "image"
          : "unknown";

  const coverUrl =
    video?.video_preview_image_url ??
    image?.resized_image_url ??
    card?.resized_image_url ??
    null;

  const bodyText = s.body?.text ?? card?.body ?? "";

  return {
    adArchiveId,
    pageId: a.page_id != null ? String(a.page_id) : fallbackPageId,
    pageName: a.page_name ?? null,
    isActive: a.is_active !== false,
    startedAtISO: unixToISO(a.start_date),
    endedAtISO: unixToISO(a.end_date),
    mediaType,
    mediaUrl: video?.video_sd_url ?? image?.resized_image_url ?? card?.resized_image_url ?? null,
    coverUrl,
    body: bodyText ?? "",
    title: s.title ?? null,
    ctaText: s.cta_text ?? null,
    ctaType: s.cta_type ?? null,
    linkUrl: s.link_url ?? null,
    adLibraryUrl:
      a.ad_library_url ?? a.url ?? `https://www.facebook.com/ads/library/?id=${adArchiveId}`,
    platforms: a.publisher_platform ?? [],
  };
}

export async function fetchCompanyAds(pageId: string): Promise<NormalizedAd[]> {
  const out: NormalizedAd[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 5 && out.length < MAX_ADS_PER_BRAND; page++) {
    const raw = (await scGet("company/ads", {
      pageId,
      trim: "false",
      ...(cursor ? { cursor } : {}),
    })) as { results?: unknown[]; ads?: unknown[]; cursor?: string | null };
    const items = raw.results ?? raw.ads ?? [];
    for (const item of items) {
      const norm = normalizeAd(item, pageId);
      if (norm) out.push(norm);
    }
    if (!raw.cursor || items.length === 0) break;
    cursor = String(raw.cursor);
  }
  // The library repeats collated variants — dedupe by archive id.
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.adArchiveId) ? false : (seen.add(a.adArchiveId), true))).slice(0, MAX_ADS_PER_BRAND);
}

// --- AI analysis -----------------------------------------------------------------

const ANALYZE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    format: {
      type: "string",
      description: "Creative execution, short label: 'UGC talking head', 'App screen demo', 'Static + text overlay', 'Before/after', 'Testimonial', 'Meme', etc.",
    },
    angle: {
      type: "string",
      description: "The persuasion angle in 2-5 Title Case words (e.g. 'All-In-One Tracking', 'Shame-Free Support', 'AI Does It For You').",
    },
    hook: { type: "string", description: "The opening hook — on-image text or first line of copy, verbatim-ish, ≤120 chars." },
    offer: { type: "string", description: "The offer/CTA framing if any ('free trial', 'quiz funnel', discount…), else empty string." },
    why_notable: {
      type: "string",
      description: "1-2 sentences: what this ad is doing strategically and what DreamMe should learn/steal/counter.",
    },
  },
  required: ["format", "angle", "hook", "offer", "why_notable"],
};

interface AdAnalysis {
  format: string;
  angle: string;
  hook: string;
  offer: string;
  why_notable: string;
}

function validateAnalysis(v: unknown): AdAnalysis {
  const o = v as Record<string, unknown>;
  return {
    format: String(o.format ?? "").slice(0, 60),
    angle: String(o.angle ?? "").slice(0, 60),
    hook: String(o.hook ?? "").slice(0, 200),
    offer: String(o.offer ?? "").slice(0, 120),
    why_notable: String(o.why_notable ?? "").slice(0, 500),
  };
}

async function analyzeAd(ad: NormalizedAd): Promise<AdAnalysis> {
  const image = ad.coverUrl ? await fetchImageBase64(ad.coverUrl) : null;
  const content: Array<Record<string, unknown>> = [];
  if (image) {
    content.push({ type: "image", source: { type: "base64", media_type: image.mime, data: image.data } });
  }
  content.push({
    type: "text",
    text:
      `Competitor Meta ad by ${ad.pageName ?? ad.pageId} (${ad.mediaType}${ad.mediaType === "video" ? " — image above is the preview frame" : ""}).\n` +
      `Running since: ${ad.startedAtISO?.slice(0, 10) ?? "?"} · Active: ${ad.isActive}\n` +
      `Title: ${ad.title ?? "(none)"}\n` +
      `CTA: ${ad.ctaText ?? "(none)"} (${ad.ctaType ?? "?"})\n` +
      `Body: ${(ad.body || "(none)").slice(0, 700)}\n` +
      (image ? "" : "\nNOTE: no creative image available — analyze from copy only.\n") +
      `\nAnalyze via emit_ad_analysis.`,
  });
  const { value } = await structuredCall<AdAnalysis>({
    model: HAIKU,
    system:
      "You analyze competitor Meta ads for DreamMe, a GLP-1 companion iOS app (shot logging, protein/fiber tracking, virtual pet). Be a sharp media buyer: name the mechanic, not the vibes. why_notable should say what DreamMe should learn or counter.",
    user: content,
    toolName: "emit_ad_analysis",
    toolDescription: "Emit the competitor-ad analysis.",
    schema: ANALYZE_SCHEMA,
    validate: validateAnalysis,
    maxTokens: 500,
  });
  return value;
}

// --- brand scrape + diff ------------------------------------------------------------

export interface CompetitorBrandRow {
  id: string;
  page_id: string;
  page_name: string;
  brand_name: string | null;
  category: string | null;
  active: boolean;
}

export interface BrandScrapeResult {
  page_id: string;
  page_name: string;
  fetched: number;
  new_ads: number;
  refreshed: number;
  marked_ended: number;
  analyze_capped: number;
  errors: Array<{ ad_archive_id: string; error: string }>;
}

export async function scrapeBrand(
  brand: Pick<CompetitorBrandRow, "id" | "page_id" | "page_name">,
  analyzeBudget = MAX_ANALYZE_PER_RUN,
): Promise<BrandScrapeResult> {
  const result: BrandScrapeResult = {
    page_id: brand.page_id,
    page_name: brand.page_name,
    fetched: 0,
    new_ads: 0,
    refreshed: 0,
    marked_ended: 0,
    analyze_capped: 0,
    errors: [],
  };

  const [ads, stored] = await Promise.all([
    fetchCompanyAds(brand.page_id),
    sbSelect<{ id: string; ad_archive_id: string; is_active: boolean }>(
      `competitor_ads?select=id,ad_archive_id,is_active&page_id=eq.${brand.page_id}&limit=5000`,
    ),
  ]);
  result.fetched = ads.length;
  const storedById = new Map(stored.map((s) => [s.ad_archive_id, s]));
  const liveIds = new Set(ads.map((a) => a.adArchiveId));

  const fresh = ads.filter((a) => !storedById.has(a.adArchiveId));
  const existing = ads.filter((a) => storedById.has(a.adArchiveId));
  let toAnalyze = fresh;
  if (toAnalyze.length > analyzeBudget) {
    result.analyze_capped = toAnalyze.length - analyzeBudget;
    toAnalyze = toAnalyze.slice(0, analyzeBudget);
  }

  // refresh existing (active flag, end date, last_seen)
  await pool(existing, 6, async (a) => {
    try {
      await sbWrite("PATCH", `competitor_ads?ad_archive_id=eq.${a.adArchiveId}`, {
        is_active: a.isActive,
        ended_at: a.endedAtISO,
        last_seen_at: new Date().toISOString(),
      });
      result.refreshed++;
    } catch (e) {
      result.errors.push({ ad_archive_id: a.adArchiveId, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // ads we had as active but that vanished from the library → ended
  const vanished = stored.filter((s) => s.is_active && !liveIds.has(s.ad_archive_id));
  await pool(vanished, 6, async (s) => {
    try {
      await sbWrite("PATCH", `competitor_ads?id=eq.${s.id}`, {
        is_active: false,
        last_seen_at: new Date().toISOString(),
      });
      result.marked_ended++;
    } catch (e) {
      result.errors.push({ ad_archive_id: s.ad_archive_id, error: e instanceof Error ? e.message : String(e) });
    }
  });

  // new ads: analyze → re-host cover → insert
  await pool(toAnalyze, ANALYZE_CONCURRENCY, async (a) => {
    try {
      const analysis = await analyzeAd(a);
      let thumb: string | null = null;
      if (a.coverUrl) {
        try {
          thumb = await fetchToStorage(a.coverUrl, `competitor-ads/${brand.page_id}/${a.adArchiveId}.jpg`);
        } catch {
          thumb = null;
        }
      }
      await sbWrite("POST", `competitor_ads?on_conflict=ad_archive_id`, {
        ad_archive_id: a.adArchiveId,
        // Store under the BRAND's page id, not the ad's own — the library
        // returns ads whose page_id can differ from the queried page (real
        // MeAgain data shows this), and brand grouping must stay stable.
        page_id: brand.page_id,
        page_name: a.pageName ?? brand.page_name,
        is_active: a.isActive,
        started_at: a.startedAtISO,
        ended_at: a.endedAtISO,
        media_type: a.mediaType,
        media_url: a.mediaUrl,
        thumbnail_url: thumb,
        body: a.body.slice(0, 4000) || null,
        title: a.title,
        cta_text: a.ctaText,
        cta_type: a.ctaType,
        link_url: a.linkUrl,
        ad_library_url: a.adLibraryUrl,
        publisher_platforms: a.platforms,
        format: analysis.format || null,
        angle: analysis.angle || null,
        hook: analysis.hook || null,
        offer: analysis.offer || null,
        why_notable: analysis.why_notable || null,
        analyzed_at: new Date().toISOString(),
      });
      result.new_ads++;
    } catch (e) {
      result.errors.push({ ad_archive_id: a.adArchiveId, error: e instanceof Error ? e.message : String(e) });
    }
  });

  await sbWrite("PATCH", `competitor_brands?id=eq.${brand.id}`, {
    last_scraped_at: new Date().toISOString(),
    last_ad_count: ads.length,
    new_last_scrape: result.new_ads,
  });

  return result;
}

export async function scrapeAllBrands(pageId?: string): Promise<{
  brands: BrandScrapeResult[];
  total_new: number;
}> {
  if (!scConfigured()) throw new Error(NO_SC_KEY);
  let brands = await sbSelect<CompetitorBrandRow>(
    `competitor_brands?select=id,page_id,page_name,brand_name,category,active&active=eq.true&limit=100`,
  );
  if (pageId) brands = brands.filter((b) => b.page_id === pageId);

  const results: BrandScrapeResult[] = [];
  let budget = MAX_ANALYZE_PER_RUN;
  for (const b of brands) {
    try {
      const r = await scrapeBrand(b, budget);
      budget = Math.max(0, budget - r.new_ads);
      results.push(r);
    } catch (e) {
      results.push({
        page_id: b.page_id,
        page_name: b.page_name,
        fetched: 0,
        new_ads: 0,
        refreshed: 0,
        marked_ended: 0,
        analyze_capped: 0,
        errors: [{ ad_archive_id: "(brand)", error: e instanceof Error ? e.message : String(e) }],
      });
    }
  }
  return { brands: results, total_new: results.reduce((s, r) => s + r.new_ads, 0) };
}

// --- recap section -------------------------------------------------------------------

export interface CompetitorWatchBrand {
  page_name: string;
  new_ads_7d: number;
  total_active: number;
  examples: Array<{ hook: string | null; angle: string | null; format: string | null; started_at: string | null; ad_library_url: string | null }>;
}

export async function fetchCompetitorWatch(): Promise<CompetitorWatchBrand[]> {
  try {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [brands, recent, active] = await Promise.all([
      sbSelect<{ page_id: string; page_name: string }>(
        `competitor_brands?select=page_id,page_name&active=eq.true&limit=100`,
      ),
      sbSelect<Record<string, unknown>>(
        `competitor_ads?select=page_id,hook,angle,format,started_at,ad_library_url&first_seen_at=gte.${since}&order=first_seen_at.desc&limit=200`,
      ),
      sbSelect<{ page_id: string }>(`competitor_ads?select=page_id&is_active=eq.true&limit=5000`),
    ]);
    const activeByPage = new Map<string, number>();
    for (const a of active) activeByPage.set(a.page_id, (activeByPage.get(a.page_id) ?? 0) + 1);
    return brands
      .map((b) => {
        const fresh = recent.filter((r) => r.page_id === b.page_id);
        return {
          page_name: b.page_name,
          new_ads_7d: fresh.length,
          total_active: activeByPage.get(b.page_id) ?? 0,
          examples: fresh.slice(0, 2).map((r) => ({
            hook: (r.hook as string | null) ?? null,
            angle: (r.angle as string | null) ?? null,
            format: (r.format as string | null) ?? null,
            started_at: (r.started_at as string | null) ?? null,
            ad_library_url: (r.ad_library_url as string | null) ?? null,
          })),
        };
      })
      .filter((b) => b.new_ads_7d > 0 || b.total_active > 0)
      .sort((a, b) => b.new_ads_7d - a.new_ads_7d);
  } catch {
    return []; // recap must never fail because competitor tables are empty/missing
  }
}
