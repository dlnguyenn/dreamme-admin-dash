import { NextResponse } from "next/server";
import {
  extractFirstSlideUrl,
  PERSONA_TIKTOK_PROFILES,
  apifyConfigured,
  runTikTokScrape,
  type ApifyTikTokPost,
} from "@/lib/apify";
import { categorizeHook, ocrFirstSlide, anthropicConfigured } from "@/lib/anthropic";
import { normalizeHook } from "@/lib/hook-categories";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { PERSONA_IDS, type PersonaId } from "@/lib/personas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function sbHeaders() {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

async function upsertPost(row: Record<string, unknown>) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tiktok_posts?on_conflict=post_url`,
    {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(row),
    },
  );
  if (!res.ok) {
    throw new Error(`tiktok_posts upsert failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

async function fetchExistingHookMeta(): Promise<Map<string, { hook: string; category: string }>> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tiktok_posts?select=post_url,first_slide_text,hook_normalized,category&limit=2000`,
    { headers: sbHeaders(), cache: "no-store" },
  );
  if (!res.ok) return new Map();
  const rows = (await res.json()) as Array<{
    post_url: string;
    first_slide_text: string | null;
    hook_normalized: string | null;
    category: string | null;
  }>;
  const m = new Map<string, { hook: string; category: string }>();
  for (const r of rows) {
    if (r.first_slide_text) {
      m.set(r.post_url, {
        hook: r.first_slide_text,
        category: r.category ?? "other",
      });
    }
  }
  return m;
}

function personaFromUsername(username: string | undefined): PersonaId | null {
  const u = (username ?? "").toLowerCase().replace(/^@/, "");
  for (const id of PERSONA_IDS) {
    if (PERSONA_TIKTOK_PROFILES[id].toLowerCase() === u) return id;
  }
  return null;
}

interface ScrapeBody {
  personas?: PersonaId[];
  resultsPerPage?: number;
  reocr?: boolean;
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req))
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!SUPABASE_URL || !SERVICE_ROLE) {
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

  let body: ScrapeBody = {};
  try {
    body = (await req.json()) as ScrapeBody;
  } catch {
    // empty body is allowed
  }
  const personas = body.personas?.length ? body.personas : PERSONA_IDS;
  const profiles = personas.map((p) => PERSONA_TIKTOK_PROFILES[p]);

  const items = await runTikTokScrape({
    profiles,
    resultsPerPage: body.resultsPerPage ?? 30,
  });

  const existing = await fetchExistingHookMeta();

  let ocrCount = 0;
  let upsertCount = 0;
  let skippedNoSlide = 0;
  const errors: string[] = [];

  for (const p of items) {
    try {
      const persona = personaFromUsername(p.authorMeta?.name);
      if (!persona) continue;
      if (!p.webVideoUrl) continue;

      const slideUrl = extractFirstSlideUrl(p);
      if (!slideUrl) {
        skippedNoSlide++;
      }

      const prior = existing.get(p.webVideoUrl);
      let hookText = prior?.hook ?? "";
      let category = prior?.category ?? "";
      if ((!hookText || body.reocr) && slideUrl) {
        hookText = await ocrFirstSlide(slideUrl);
        ocrCount++;
        category = await categorizeHook(hookText);
      } else if (!category && hookText) {
        category = await categorizeHook(hookText);
      }

      const row = {
        persona,
        post_id: p.id ?? null,
        post_url: p.webVideoUrl,
        posted_at: p.createTimeISO ?? null,
        view_count: p.playCount ?? 0,
        like_count: p.diggCount ?? 0,
        comment_count: p.commentCount ?? 0,
        share_count: p.shareCount ?? 0,
        caption: p.text ?? "",
        first_slide_url: slideUrl,
        first_slide_text: hookText,
        hook_normalized: normalizeHook(hookText),
        category: category || null,
        last_scraped_at: new Date().toISOString(),
      };
      await upsertPost(row);
      upsertCount++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: items.length,
    upserted: upsertCount,
    ocred: ocrCount,
    skippedNoSlide,
    errors: errors.slice(0, 5),
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/scrape/tiktok",
    auth: "X-DreamMe-Secret: <INGEST_TOKEN or CRON_SECRET>",
    body: {
      personas: "optional PersonaId[] (default: all three)",
      resultsPerPage: "optional number (default 30)",
      reocr: "optional boolean — re-OCR even if hook already known",
    },
  });
}
