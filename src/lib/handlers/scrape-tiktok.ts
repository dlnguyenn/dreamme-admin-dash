import { NextResponse } from "next/server";
import { parseApifyItems, type ApifyTikTokItem } from "@/lib/schemas/apify";
import {
  PERSONA_IDS,
  isPersonaId,
  type PersonaId,
} from "@/lib/personas";
import { PERSONA_TIKTOK_PROFILES, extractFirstSlideUrl } from "@/lib/apify";
import { normalizeHook } from "@/lib/hook-categories";
import type { HookRepository } from "@/lib/repositories/hook-repository";
import {
  classifyPerformance,
  type BaselineMap,
  type PerformanceClass,
} from "@/lib/baseline";
import {
  loadIndex,
  tryMatch,
  tryMatchByEmbedding,
  type MatcherIndex,
  type MatcherStore,
} from "@/lib/hook-matcher";
import { embedOne, voyageConfigured, toPgVector } from "@/lib/voyage";
import {
  attachOrCreate,
  type FamilyRow,
  type FamilyStore,
} from "@/lib/families";

export interface Scraper {
  run(opts: { profiles: string[]; resultsPerPage: number }): Promise<unknown>;
}

export interface OCR {
  extract(imageUrl: string): Promise<string>;
  categorize(hookText: string): Promise<string>;
}

export interface FeedbackDeps {
  baselines: BaselineMap;
  matcherStore: MatcherStore;
  familyStore?: FamilyStore;
}

export interface ScrapeRequestBody {
  personas?: PersonaId[];
  resultsPerPage?: number;
  reocr?: boolean;
}

export interface ScrapeResult {
  ok: true;
  scanned: number;
  upserted: number;
  ocred: number;
  skippedNoSlide: number;
  parseFailed: number;
  matched: number;
  matchedEmbedding: number;
  embedded: number;
  newFamilies: number;
  errors: string[];
}

function personaFromUsername(username: string | undefined): PersonaId | null {
  const u = (username ?? "").toLowerCase().replace(/^@/, "");
  for (const id of PERSONA_IDS) {
    const handle = PERSONA_TIKTOK_PROFILES[id];
    if (handle && handle.toLowerCase() === u) return id;
  }
  return null;
}

async function readBody(req: Request): Promise<ScrapeRequestBody> {
  try {
    const raw = (await req.json()) as unknown;
    if (!raw || typeof raw !== "object") return {};
    const body = raw as Record<string, unknown>;
    const out: ScrapeRequestBody = {};
    if (Array.isArray(body.personas)) {
      out.personas = body.personas.filter(isPersonaId);
    }
    if (typeof body.resultsPerPage === "number" && body.resultsPerPage > 0) {
      out.resultsPerPage = Math.floor(body.resultsPerPage);
    }
    if (typeof body.reocr === "boolean") out.reocr = body.reocr;
    return out;
  } catch {
    return {};
  }
}

export async function handleScrape(
  req: Request,
  deps: {
    scraper: Scraper;
    repo: HookRepository;
    ocr: OCR;
    feedback?: FeedbackDeps;
  },
): Promise<Response> {
  const body = await readBody(req);
  const personas = body.personas?.length ? body.personas : PERSONA_IDS;
  const profiles = personas.map((p) => PERSONA_TIKTOK_PROFILES[p]).filter(Boolean);
  const resultsPerPage = body.resultsPerPage ?? 1000;

  const raw = await deps.scraper.run({ profiles, resultsPerPage });
  const { items, failed: parseFailed } = parseApifyItems(raw);
  const existing = await deps.repo.fetchExistingMeta();

  logApifyRunSummary({ raw, items, parseFailed, profiles });

  let matcherIndex: MatcherIndex | null = null;
  if (deps.feedback) {
    try {
      matcherIndex = await loadIndex(deps.feedback.matcherStore);
    } catch (e) {
      console.warn("[scrape-tiktok] matcher index load failed", e);
    }
  }

  let families: FamilyRow[] | null = null;
  if (deps.feedback?.familyStore && voyageConfigured()) {
    try {
      families = await deps.feedback.familyStore.fetchAll();
    } catch (e) {
      console.warn("[scrape-tiktok] family fetch failed", e);
    }
  }
  const familiesAtStart = families?.length ?? 0;

  let ocred = 0;
  let upserted = 0;
  let skippedNoSlide = 0;
  let matched = 0;
  let matchedEmbedding = 0;
  let embedded = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      await processItem(item, {
        existing,
        reocr: body.reocr === true,
        ocr: deps.ocr,
        repo: deps.repo,
        feedback: deps.feedback,
        matcherIndex,
        families,
        onOcr: () => ocred++,
        onUpsert: () => upserted++,
        onSkipNoSlide: () => skippedNoSlide++,
        onMatch: () => matched++,
        onMatchEmbedding: () => matchedEmbedding++,
        onEmbed: () => embedded++,
      });
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  const result: ScrapeResult = {
    ok: true,
    scanned: items.length,
    upserted,
    ocred,
    skippedNoSlide,
    parseFailed,
    matched,
    matchedEmbedding,
    embedded,
    newFamilies: (families?.length ?? 0) - familiesAtStart,
    errors: errors.slice(0, 5),
  };
  return NextResponse.json(result);
}

function logApifyRunSummary(params: {
  raw: unknown;
  items: ApifyTikTokItem[];
  parseFailed: number;
  profiles: string[];
}): void {
  const rawCount = Array.isArray(params.raw) ? params.raw.length : 0;
  const firstRaw =
    Array.isArray(params.raw) && params.raw.length > 0
      ? (params.raw[0] as Record<string, unknown>)
      : null;
  const topLevelKeys = firstRaw ? Object.keys(firstRaw).sort() : [];
  const perAuthor: Record<string, number> = {};
  for (const it of params.items) {
    const name = it.authorMeta?.name ?? "(unknown)";
    perAuthor[name] = (perAuthor[name] ?? 0) + 1;
  }
  const slideshowCount = params.items.filter((it) => it.isSlideshow).length;
  console.log(
    "[scrape-tiktok]",
    JSON.stringify({
      profiles: params.profiles,
      rawCount,
      parsedCount: params.items.length,
      parseFailed: params.parseFailed,
      slideshowCount,
      perAuthor,
      firstItemTopLevelKeys: topLevelKeys,
    }),
  );
}

async function processItem(
  item: ApifyTikTokItem,
  ctx: {
    existing: Map<string, { hook: string; category: string }>;
    reocr: boolean;
    ocr: OCR;
    repo: HookRepository;
    feedback?: FeedbackDeps;
    matcherIndex: MatcherIndex | null;
    families: FamilyRow[] | null;
    onOcr: () => void;
    onUpsert: () => void;
    onSkipNoSlide: () => void;
    onMatch: () => void;
    onMatchEmbedding: () => void;
    onEmbed: () => void;
  },
): Promise<void> {
  const persona = personaFromUsername(item.authorMeta?.name);
  if (!persona) return;
  if (!item.webVideoUrl) return;

  const slideUrl = extractFirstSlideUrl(item);
  const prior = ctx.existing.get(item.webVideoUrl);

  if (!slideUrl && !prior) {
    ctx.onSkipNoSlide();
    return;
  }

  let hookText = prior?.hook ?? "";
  let category = prior?.category ?? "";
  if ((!hookText || ctx.reocr) && slideUrl) {
    hookText = await ctx.ocr.extract(slideUrl);
    ctx.onOcr();
    category = await ctx.ocr.categorize(hookText);
  } else if (!category && hookText) {
    category = await ctx.ocr.categorize(hookText);
  }

  const views = item.playCount ?? 0;
  const hookNormalized = normalizeHook(hookText);
  let performance_ratio: number | null = null;
  let performance_class: PerformanceClass | null = null;
  if (ctx.feedback) {
    const cls = classifyPerformance(views, persona, ctx.feedback.baselines);
    performance_ratio = cls.ratio;
    performance_class = cls.class;
  }

  // Embed + cluster: only if voyage configured, families fetched, and the
  // post has hook text. We always re-embed when OCR ran (hook text might
  // have changed); when reusing prior hook text we skip to keep the
  // scrape's hot path fast — backfill catches those.
  let embedding: number[] | null = null;
  let family_id: string | null = null;
  const ranOcr = (!prior || ctx.reocr) && !!slideUrl;
  if (
    ctx.feedback?.familyStore &&
    ctx.families &&
    voyageConfigured() &&
    hookText.trim() &&
    ranOcr
  ) {
    try {
      embedding = await embedOne(hookText);
      ctx.onEmbed();
      const attach = await attachOrCreate(
        ctx.feedback.familyStore,
        ctx.families,
        {
          embedding,
          exemplar_text: hookText,
          category: category || null,
        },
      );
      family_id = attach.familyId;
    } catch (e) {
      console.warn("[scrape-tiktok] embed/family-attach failed", e);
      embedding = null;
      family_id = null;
    }
  }

  const slideCount = item.slideshowImageLinks?.length ?? 0;
  const postId = await ctx.repo.upsert({
    persona,
    post_id: item.id ?? null,
    post_url: item.webVideoUrl,
    posted_at: item.createTimeISO ?? null,
    view_count: views,
    like_count: item.diggCount ?? 0,
    comment_count: item.commentCount ?? 0,
    share_count: item.shareCount ?? 0,
    caption: item.text ?? "",
    first_slide_url: slideUrl,
    first_slide_text: hookText,
    hook_normalized: hookNormalized,
    category: category || null,
    last_scraped_at: new Date().toISOString(),
    performance_ratio,
    performance_class,
    embedding: embedding ? toPgVector(embedding) : null,
    family_id,
    slide_count: slideCount,
  });
  ctx.onUpsert();

  if (!ctx.feedback || !ctx.matcherIndex || !postId) return;

  // Tier 1: exact normalized text match.
  if (hookNormalized) {
    const t1 = tryMatch(ctx.matcherIndex, {
      postId,
      postUrl: item.webVideoUrl,
      persona,
      hookNormalized,
      postedAt: item.createTimeISO ?? null,
    });
    if (t1) {
      try {
        await ctx.feedback.matcherStore.persistMatch({
          generatedHookId: t1.id,
          postId,
          deployedAt: item.createTimeISO ?? new Date().toISOString(),
          confidence: 1.0,
          source: "auto_normalized",
          familyId: family_id ?? null,
        });
        ctx.onMatch();
      } catch (e) {
        console.warn("[scrape-tiktok] persistMatch (tier 1) failed", e);
      }
      return;
    }
  }

  // Tier 2: cosine similarity match within the 14-day window.
  if (embedding) {
    const t2 = tryMatchByEmbedding(ctx.matcherIndex, {
      persona,
      postEmbedding: embedding,
      postedAt: item.createTimeISO ?? null,
    });
    if (t2) {
      try {
        await ctx.feedback.matcherStore.persistMatch({
          generatedHookId: t2.match.id,
          postId,
          deployedAt: item.createTimeISO ?? new Date().toISOString(),
          confidence: t2.similarity,
          source: "auto_embedding",
          familyId: family_id ?? null,
        });
        ctx.onMatchEmbedding();
      } catch (e) {
        console.warn("[scrape-tiktok] persistMatch (tier 2) failed", e);
      }
    }
  }
}
