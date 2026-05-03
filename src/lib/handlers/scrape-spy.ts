import { NextResponse } from "next/server";
import { parseApifyItems, type ApifyTikTokItem } from "@/lib/schemas/apify";
import { extractFirstSlideUrl } from "@/lib/apify";
import { runHashtagScrape, runSearchQueryScrape } from "@/lib/apify-spy";
import { normalizeHook } from "@/lib/hook-categories";
import { ocrFirstSlide, categorizeHook } from "@/lib/anthropic";
import { fetchToStorage, storageConfigured } from "@/lib/storage";
import { SPY_HASHTAGS } from "@/lib/spy-hashtags";
import { SPY_QUERIES } from "@/lib/spy-queries";
import { computeIsViral } from "@/lib/spy-viral";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

export interface ScrapeSpyResult {
  ok: true;
  scannedHashtags: number;
  scannedQueries: number;
  scannedItems: number;
  inserted: number;
  updated: number;
  skippedNoSlide: number;
  ocred: number;
  reHosted: number;
  viralFlagged: number;
  parseFailed: number;
  errors: string[];
}

interface ExistingRow {
  id: string;
  view_count: number;
  posted_at: string | null;
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
    `${SUPABASE_URL}/rest/v1/spy_videos?select=id,post_url,view_count,posted_at&post_url=in.${encodeURIComponent(inClause)}`,
    { headers: sbHeaders(), cache: "no-store" },
  );
  if (!res.ok) return new Map();
  const rows = (await res.json()) as Array<{
    id: string;
    post_url: string;
    view_count: number;
    posted_at: string | null;
  }>;
  const out = new Map<string, ExistingRow>();
  for (const r of rows) {
    out.set(r.post_url, {
      id: r.id,
      view_count: r.view_count,
      posted_at: r.posted_at,
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
  skippedNoSlide: number;
  ocred: number;
  reHosted: number;
  viralFlagged: number;
  parseFailed: number;
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
  },
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

      if (existingRow) {
        const isViral = computeIsViral(
          { view_count: views, posted_at: postedAt },
          now,
        );
        const patch: Record<string, unknown> = {
          view_count: views,
          like_count: Number(item.diggCount ?? 0),
          comment_count: Number(item.commentCount ?? 0),
          share_count: Number(item.shareCount ?? 0),
          last_scraped_at: now.toISOString(),
          is_viral: isViral,
        };
        if (isViral) patch.viral_first_seen_at = now.toISOString();
        await patchSpyVideo(existingRow.id, patch);
        counters.updated++;
        if (isViral) counters.viralFlagged++;
        continue;
      }

      // New video: rehost first slide, OCR, categorize, insert
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

      const isViral = computeIsViral(
        { view_count: views, posted_at: postedAt },
        now,
      );
      if (isViral) counters.viralFlagged++;

      await insertSpyVideo({
        source_hashtag: ctx.sourceLabel,
        source_type: ctx.sourceType,
        tiktok_id: item.id ?? null,
        post_url: url,
        author_handle: item.authorMeta?.name ?? null,
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

export async function handleSpyScrape(opts: {
  resultsPerPage?: number;
  hashtags?: readonly string[];
  queries?: readonly string[];
  deps?: SpyDeps;
}): Promise<Response> {
  const hashtags = opts.hashtags ?? SPY_HASHTAGS;
  const queries = opts.queries ?? SPY_QUERIES;
  const resultsPerPage = opts.resultsPerPage ?? 30;
  const scraper = opts.deps?.scraper ?? {
    run: (o) => runHashtagScrape(o),
  };
  const searchScraper = opts.deps?.searchScraper ?? {
    run: (o) => runSearchQueryScrape(o),
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
    skippedNoSlide: 0,
    ocred: 0,
    reHosted: 0,
    viralFlagged: 0,
    parseFailed: 0,
  };
  const errors: string[] = [];
  const now = new Date();

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
      { ocr, rehost },
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
      { ocr, rehost },
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
