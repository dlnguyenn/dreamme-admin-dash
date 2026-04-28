import { NextResponse } from "next/server";
import { apifyConfigured, runTikTokScrape } from "@/lib/apify";
import {
  anthropicConfigured,
  categorizeHook,
  ocrFirstSlide,
} from "@/lib/anthropic";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { handleScrape } from "@/lib/handlers/scrape-tiktok";
import { createPostgrestHookRepository } from "@/lib/repositories/hook-repository";
import { loadBaselines } from "@/lib/baseline";
import { createPostgrestMatcherStore } from "@/lib/hook-matcher";
import { createPostgrestFamilyStore } from "@/lib/families";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !(process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }
  if (!apifyConfigured()) {
    return NextResponse.json(
      { ok: false, error: "APIFY_KEY not set" },
      { status: 500 },
    );
  }
  if (!anthropicConfigured()) {
    return NextResponse.json(
      { ok: false, error: "ANTHROPIC_API_KEY not set" },
      { status: 500 },
    );
  }

  const baselines = await loadBaselines().catch(() => new Map());
  const matcherStore = createPostgrestMatcherStore();
  const familyStore = createPostgrestFamilyStore();

  return handleScrape(req, {
    scraper: { run: (opts) => runTikTokScrape(opts) },
    repo: createPostgrestHookRepository(),
    ocr: {
      extract: (url) => ocrFirstSlide(url),
      categorize: (hook) => categorizeHook(hook),
    },
    feedback: { baselines, matcherStore, familyStore },
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/scrape/tiktok",
    auth: "X-DreamMe-Secret: <INGEST_TOKEN or CRON_SECRET>",
    body: {
      personas: "optional PersonaId[] (default: all configured handles in PERSONA_TIKTOK_PROFILES)",
      resultsPerPage: "optional number (default 30)",
      reocr: "optional boolean â€” re-OCR even if hook already known",
    },
  });
}
