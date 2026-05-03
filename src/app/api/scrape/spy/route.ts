import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { handleSpyScrape } from "@/lib/handlers/scrape-spy";
import { apifySpyConfigured } from "@/lib/apify-spy";
import { anthropicConfigured } from "@/lib/anthropic";

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
  if (!apifySpyConfigured()) {
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
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !(process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY)
  ) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }

  let body: { resultsPerPage?: number; hashtags?: string[]; queries?: string[] } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // empty body allowed
  }

  return handleSpyScrape({
    resultsPerPage: body.resultsPerPage,
    hashtags: body.hashtags,
    queries: body.queries,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/scrape/spy",
    auth: "X-DreamMe-Secret: <INGEST_TOKEN or CRON_SECRET>",
    body: {
      resultsPerPage: "optional number (default 30)",
      hashtags:
        "optional string[] (default: SPY_HASHTAGS from src/lib/spy-hashtags.ts)",
      queries:
        "optional string[] (default: SPY_QUERIES from src/lib/spy-queries.ts)",
    },
    notes:
      "Scrapes configured GLP-1 hashtags AND free-text search queries via Apify clockworks/tiktok-scraper, OCRs first slides, categorizes hooks, and upserts into spy_videos. Each row is tagged with source_type='hashtag' or 'search'. Daily cron at /api/cron/scrape-spy fires this at 03:00 UTC.",
  });
}
