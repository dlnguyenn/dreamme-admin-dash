import { NextResponse } from "next/server";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  generateCaption,
  compressCaption,
  captionGeneratorConfigured,
} from "@/lib/caption-generator";
import { MODELS, isModelId } from "@/lib/models";
import { checkIngestAuth } from "@/lib/auth-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";

const Body = z.object({
  hookId: z.string().min(1),
  hookText: z.string().min(1).max(1000),
  model: z.string().refine(isModelId, { message: "invalid model" }),
  notes: z.string().max(2000).optional(),
  tipPoolAware: z.boolean(),
});

let STYLE_GUIDE_CACHE: string | null = null;

function loadStyleGuide(): string {
  if (STYLE_GUIDE_CACHE) return STYLE_GUIDE_CACHE;
  const p = path.join(process.cwd(), "src", "prompts", "caption-style-guide.md");
  STYLE_GUIDE_CACHE = fs.readFileSync(p, "utf8");
  return STYLE_GUIDE_CACHE;
}

async function fetchRecentTipHeaders(limit = 20): Promise<string[]> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return [];
  const url = `${SUPABASE_URL}/rest/v1/saved_captions?select=caption&order=created_at.desc&limit=${limit}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<{ caption: string | null }>;
  const headers = new Set<string>();
  for (const r of rows) {
    const text = r.caption ?? "";
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("âœ…")) {
        const stripped = trimmed
          .replace(/^âœ…\s*\d+\.?\s*/, "")
          .replace(/[.!?]+$/, "")
          .trim();
        if (stripped) headers.add(stripped);
      }
    }
  }
  return Array.from(headers);
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!captionGeneratorConfigured()) {
    return NextResponse.json(
      { ok: false, error: "ANTHROPIC_API_KEY not set on server" },
      { status: 500 },
    );
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 400 },
    );
  }

  try {
    const styleGuide = loadStyleGuide();
    const avoidThemes = parsed.tipPoolAware
      ? await fetchRecentTipHeaders(20)
      : [];

    let out = await generateCaption({
      hook: parsed.hookText,
      model: parsed.model,
      notes: parsed.notes,
      avoidThemes,
      styleGuide,
    });

    const HARD_CEILING = 4000;
    const MAX_COMPRESS_ATTEMPTS = 2;
    let compressAttempts = 0;
    while (out.charCount > HARD_CEILING && compressAttempts < MAX_COMPRESS_ATTEMPTS) {
      compressAttempts++;
      out = await compressCaption({
        oversizedCaption: out.caption,
        model: parsed.model,
        styleGuide,
      });
    }

    if (out.charCount > HARD_CEILING) {
      return NextResponse.json(
        {
          ok: false,
          error: `Could not fit caption under ${HARD_CEILING} characters after ${MAX_COMPRESS_ATTEMPTS} retries (last: ${out.charCount}).`,
          charCount: out.charCount,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      caption: out.caption,
      charCount: out.charCount,
      avoidedThemes: avoidThemes.length,
      compressAttempts,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/generate/caption",
    models: [MODELS.SONNET_4_6, MODELS.OPUS_4_7],
    body: {
      hookId: "string",
      hookText: "string",
      model: "claude-sonnet-4-6 | claude-opus-4-7",
      notes: "optional string",
      tipPoolAware: "boolean",
    },
  });
}
