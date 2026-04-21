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

export interface Scraper {
  run(opts: { profiles: string[]; resultsPerPage: number }): Promise<unknown>;
}

export interface OCR {
  extract(imageUrl: string): Promise<string>;
  categorize(hookText: string): Promise<string>;
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
  errors: string[];
}

function personaFromUsername(username: string | undefined): PersonaId | null {
  const u = (username ?? "").toLowerCase().replace(/^@/, "");
  for (const id of PERSONA_IDS) {
    if (PERSONA_TIKTOK_PROFILES[id].toLowerCase() === u) return id;
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
  deps: { scraper: Scraper; repo: HookRepository; ocr: OCR },
): Promise<Response> {
  const body = await readBody(req);
  const personas = body.personas?.length ? body.personas : PERSONA_IDS;
  const profiles = personas.map((p) => PERSONA_TIKTOK_PROFILES[p]);
  const resultsPerPage = body.resultsPerPage ?? 30;

  const raw = await deps.scraper.run({ profiles, resultsPerPage });
  const { items, failed: parseFailed } = parseApifyItems(raw);
  const existing = await deps.repo.fetchExistingMeta();

  logApifyRunSummary({ raw, items, parseFailed, profiles });

  let ocred = 0;
  let upserted = 0;
  let skippedNoSlide = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      await processItem(item, {
        existing,
        reocr: body.reocr === true,
        ocr: deps.ocr,
        repo: deps.repo,
        onOcr: () => ocred++,
        onUpsert: () => upserted++,
        onSkipNoSlide: () => skippedNoSlide++,
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
    onOcr: () => void;
    onUpsert: () => void;
    onSkipNoSlide: () => void;
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

  await ctx.repo.upsert({
    persona,
    post_id: item.id ?? null,
    post_url: item.webVideoUrl,
    posted_at: item.createTimeISO ?? null,
    view_count: item.playCount ?? 0,
    like_count: item.diggCount ?? 0,
    comment_count: item.commentCount ?? 0,
    share_count: item.shareCount ?? 0,
    caption: item.text ?? "",
    first_slide_url: slideUrl,
    first_slide_text: hookText,
    hook_normalized: normalizeHook(hookText),
    category: category || null,
    last_scraped_at: new Date().toISOString(),
  });
  ctx.onUpsert();
}
