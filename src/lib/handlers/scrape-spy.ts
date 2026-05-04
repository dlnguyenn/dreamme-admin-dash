import { NextResponse } from "next/server";
import { parseApifyItems, type ApifyTikTokItem } from "@/lib/schemas/apify";
import { extractFirstSlideUrl } from "@/lib/apify";
import {
  runHashtagScrape,
  runSearchQueryScrape,
  runProfileScrape,
} from "@/lib/apify-spy";
import { normalizeHook } from "@/lib/hook-categories";
import { ocrFirstSlide, categorizeHook } from "@/lib/anthropic";
import { fetchToStorage, storageConfigured } from "@/lib/storage";
import { SPY_HASHTAGS } from "@/lib/spy-hashtags";
import { SPY_QUERIES } from "@/lib/spy-queries";
import {
  computeBaselineMedian,
  computeOutlierScore,
  computeViewsPerHour,
  isViralOutlier,
} from "@/lib/spy-outlier";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const MIN_VIEWS_FOR_LIBRARY = 10_000;

export interface ScrapeSpyResult {
  ok: true;
  scannedHashtags: number;
  scannedQueries: number;
  scannedItems: number;
  inserted: number;
  updated: number;
  skippedLowViews: number;
  skippedNoSlide: number;
  ocred: number;
  reHosted: number;
  viralFlagged: number;
  parseFailed: number;
  baselinesFetched: number;
  errors: string[];
}

interface ExistingRow {
  id: string;
  view_count: number;
  posted_at: string | null;
  author_baseline_median: number | null;
}

function sbHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

async function fetchExistingByUrl(
  postUrls: string[],
): Promise<Map<string, ExistingRow>> {
  if (postUrls.length === 0) return new Map();
  const inClause = `(${postUrls.map((u) => `"${u}"`).join(",")})`;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/spy_videos?select=id,post_url,view_count,posted_at,author_baseline_median&post_url=in.${encodeURIComponent(inClause)}`,
    { headers: sbHeaders(), cache: "no-store" },
  );
  if (!res.ok) return new Map();
  const rows = (await res.json()) as Array<{
    id: string;
    post_url: string;
    view_count: number;
    posted_at: string | null;
    author_baseline_median: number | null;
  }>;
  const out = new Map<string, ExistingRow>();
  for (const r of rows) {
    out.set(r.post_url, {
      id: r.id,
      view_count: r.view_count,
      posted_at: r.posted_at,
      author_baseline_median: r.author_baseline_median,
    });
  }
  return out;
}

async function insertSpyVideo(row: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/spy_videos`, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(
      `spy_videos insert failed: ${res.status} ${await res.text()}`,
    );
  }
}

async function patchSpyVideo(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/spy_videos?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...sbHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(
      `spy_videos patch failed: ${res.status} ${await res.text()}`,
    );
  }
}

function pickExt(slideUrl: string | null): string {
  if (!slideUrl) return "jpg";
  const m = slideUrl.match(/\.(jpe?g|png|webp|gif)(?:\?|$)/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

function slugForPath(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

interface SpyDeps {
  scraper?: {
    run(opts: { hashtag: string; resultsPerPage: number }): Promise<unknown[]>;
  };
  searchScraper?: {
    run(opts: { query: string; resultsPerPage: number }): Promise<unknown[]>;
  };
  profileScraper?: {
    run(opts: { profile: string; resultsPerPage: number }): Promise<unknown[]>;
  };
  ocr?: {
    extract(imageUrl: string): Promise<string>;
    categorize(hookText: string): Promise<string>;
  };
  rehoster?: (remoteUrl: string, path: string) => Promise<string>;
}

interface Counters {
  scannedItems: number;
  inserted: number;
  updated: number;
  skippedLowViews: number;
  skippedNoSlide: number;
  ocred: number;
  reHosted: number;
  viralFlagged: number;
  parseFailed: number;
  baselinesFetched: number;
}

interface AuthorBaseline {
  median: number | null;
  count: number;
}

interface SourceContext {
  sourceType: "hashtag" | "search";
  sourceLabel: string; // hashtag name or query string
  pathSegment: string; // for storage path: spy/{pathSegment}/{id}.{ext}
  fetchRaw: () => Promise<unknown[]>;
  errorPrefix: string;
}

async function scrapeOneSource(
  ctx: SourceContext,
  counters: Counters,
  errors: string[],
  deps: {
    ocr: NonNullable<SpyDeps["ocr"]>;
    rehost: NonNullable<SpyDeps["rehoster"]>;
    profileScraper: NonNullable<SpyDeps["profileScraper"]>;
  },
  baselineCache: Map<string, AuthorBaseline>,
  now: Date,
): Promise<void> {
  let raw: unknown[] = [];
  try {
    raw = await ctx.fetchRaw();
  } catch (e) {
    errors.push(`${ctx.errorPrefix}: ${(e as Error).message}`);
    return;
  }
  const { items, failed } = parseApifyItems(raw);
  counters.parseFailed += failed;
  counters.scannedItems += items.length;

  const urls = items
    .map((i: ApifyTikTokItem) => i.webVideoUrl)
    .filter((u): u is string => !!u);
  const existing = await fetchExistingByUrl(urls);

  for (const item of items) {
    try {
      if (!item.webVideoUrl) continue;
      const url = item.webVideoUrl;
      const views = Number(item.playCount ?? 0);
      const postedAt = item.createTimeISO ?? null;
      const existingRow = existing.get(url);
      const viewsPerHour = computeViewsPerHour(views, postedAt, now);

      if (existingRow) {
        // Reuse the previously-stored baseline; we don't re-scrape the
        // author on update — baselines drift slowly and the cost adds up.
        const outlierScore = computeOutlierScore(
          views,
          existingRow.author_baseline_median,
        );
        const isViral = isViralOutlier({
          view_count: views,
          posted_at: postedAt,
          outlier_score: outlierScore,
          now,
        });
        const patch: Record<string, unknown> = {
          view_count: views,
          like_count: Number(item.diggCount ?? 0),
          comment_count: Number(item.commentCount ?? 0),
          share_count: Number(item.shareCount ?? 0),
          views_per_hour: viewsPerHour,
          outlier_score: outlierScore,
          last_scraped_at: now.toISOString(),
          is_viral: isViral,
        };
        if (isViral) patch.viral_first_seen_at = now.toISOString();
        await patchSpyVideo(existingRow.id, patch);
        counters.updated++;
        if (isViral) counters.viralFlagged++;
        continue;
      }

      // 10K view floor: skip OCR, storage, baseline scrape, and insert
      // for low-view content. The actor returns it regardless (we already
      // pay Apify) but the library stays focused on replication-worthy
      // posts. View counts only go up, so a post that's <10K today and
      // viral tomorrow will get caught on the next scrape.
      if (views < MIN_VIEWS_FOR_LIBRARY) {
        counters.skippedLowViews++;
        continue;
      }

      // New video: rehost first slide, OCR, categorize, scrape author
      // baseline, then insert.
      const slideUrl = extractFirstSlideUrl(item);
      let firstSlideUrl: string | null = null;
      let hookText = "";
      let category: string = "other";
      const slideCount = item.slideshowImageLinks?.length ?? 0;

      if (!slideUrl) {
        counters.skippedNoSlide++;
      } else if (storageConfigured()) {
        try {
          const ext = pickExt(slideUrl);
          const id = item.id ?? Math.random().toString(36).slice(2, 10);
          firstSlideUrl = await deps.rehost(
            slideUrl,
            `spy/${ctx.pathSegment}/${id}.${ext}`,
          );
          counters.reHosted++;
        } catch (e) {
          errors.push(`rehost ${url}: ${(e as Error).message}`);
          firstSlideUrl = slideUrl;
        }
        try {
          hookText = await deps.ocr.extract(firstSlideUrl ?? slideUrl);
          counters.ocred++;
          if (hookText) category = await deps.ocr.categorize(hookText);
        } catch (e) {
          errors.push(`ocr ${url}: ${(e as Error).message}`);
        }
      }

      const authorHandle = item.authorMeta?.name ?? null;
      const baseline = authorHandle
        ? await getOrFetchBaseline(
            authorHandle,
            baselineCache,
            counters,
            errors,
            deps.profileScraper,
          )
        : { median: null, count: 0 };
      const outlierScore = computeOutlierScore(views, baseline.median);
      const isViral = isViralOutlier({
        view_count: views,
        posted_at: postedAt,
        outlier_score: outlierScore,
        now,
      });
      if (isViral) counters.viralFlagged++;

      await insertSpyVideo({
        source_hashtag: ctx.sourceLabel,
        source_type: ctx.sourceType,
        tiktok_id: item.id ?? null,
        post_url: url,
        author_handle: authorHandle,
        posted_at: postedAt,
        view_count: views,
        like_count: Number(item.diggCount ?? 0),
        comment_count: Number(item.commentCount ?? 0),
        share_count: Number(item.shareCount ?? 0),
        caption: item.text ?? "",
        first_slide_url: firstSlideUrl,
        first_slide_text: hookText,
        hook_normalized: normalizeHook(hookText),
        category,
        slide_count: slideCount,
        views_per_hour: viewsPerHour,
        author_baseline_median: baseline.median,
        author_baseline_count: baseline.count,
        outlier_score: outlierScore,
        is_viral: isViral,
        viral_first_seen_at: isViral ? now.toISOString() : null,
        last_scraped_at: now.toISOString(),
      });
      counters.inserted++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
}

async function getOrFetchBaseline(
  handle: string,
  cache: Map<string, AuthorBaseline>,
  counters: Counters,
  errors: string[],
  profileScraper: NonNullable<SpyDeps["profileScraper"]>,
): Promise<AuthorBaseline> {
  const cached = cache.get(handle);
  if (cached) return cached;
  let result: AuthorBaseline = { median: null, count: 0 };
  try {
    const raw = await profileScraper.run({ profile: handle, resultsPerPage: 10 });
    counters.baselinesFetched++;
    const { items } = parseApifyItems(raw);
    const views = items
      .map((i: ApifyTikTokItem) => Number(i.playCount ?? 0))
      .filter((v: number) => v > 0);
    result = { median: computeBaselineMedian(views), count: views.length };
  } catch (e) {
    errors.push(`baseline ${handle}: ${(e as Error).message}`);
  }
  cache.set(handle, result);
  return result;
}

export async function handleSpyScrape(opts: {
  resultsPerPage?: number;
  hashtags?: readonly string[];
  queries?: readonly string[];
  deps?: SpyDeps;
}): Promise<Response> {
  const hashtags = opts.hashtags ?? SPY_HASHTAGS;
  const queries = opts.queries ?? SPY_QUERIES;
  const resultsPerPage = opts.resultsPerPage ?? 15;
  const scraper = opts.deps?.scraper ?? {
    run: (o) => runHashtagScrape(o),
  };
  const searchScraper = opts.deps?.searchScraper ?? {
    run: (o) => runSearchQueryScrape(o),
  };
  const profileScraper = opts.deps?.profileScraper ?? {
    run: (o) => runProfileScrape(o),
  };
  const ocr = opts.deps?.ocr ?? {
    extract: (url: string) => ocrFirstSlide(url),
    categorize: (h: string) => categorizeHook(h),
  };
  const rehost = opts.deps?.rehoster ?? fetchToStorage;

  const counters: Counters = {
    scannedItems: 0,
    inserted: 0,
    updated: 0,
    skippedLowViews: 0,
    skippedNoSlide: 0,
    ocred: 0,
    reHosted: 0,
    viralFlagged: 0,
    parseFailed: 0,
    baselinesFetched: 0,
  };
  const errors: string[] = [];
  const now = new Date();
  // Per-run author cache: scrape each author's baseline once even if
  // they appear across multiple hashtag / search results.
  const baselineCache = new Map<string, AuthorBaseline>();

  // Hashtag mode
  for (const hashtag of hashtags) {
    await scrapeOneSource(
      {
        sourceType: "hashtag",
        sourceLabel: hashtag,
        pathSegment: hashtag,
        fetchRaw: () => scraper.run({ hashtag, resultsPerPage }),
        errorPrefix: `apify hashtag ${hashtag}`,
      },
      counters,
      errors,
      { ocr, rehost, profileScraper },
      baselineCache,
      now,
    );
  }

  // Search-query mode
  for (const query of queries) {
    await scrapeOneSource(
      {
        sourceType: "search",
        sourceLabel: query,
        pathSegment: `search/${slugForPath(query)}`,
        fetchRaw: () => searchScraper.run({ query, resultsPerPage }),
        errorPrefix: `apify query ${query}`,
      },
      counters,
      errors,
      { ocr, rehost, profileScraper },
      baselineCache,
      now,
    );
  }

  const result: ScrapeSpyResult = {
    ok: true,
    scannedHashtags: hashtags.length,
    scannedQueries: queries.length,
    ...counters,
    errors: errors.slice(0, 10),
  };
  return NextResponse.json(result);
}
