import { NextResponse } from "next/server";
import { z } from "zod";
import {
  generateInstagramCaption,
  compressInstagramCaption,
  captionGeneratorConfigured,
} from "@/lib/caption-generator";
import { INSTAGRAM_CHAR_CEILING } from "@/lib/prompts/instagramCaption";
import { isModelId, MODELS } from "@/lib/models";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { PERSONA_IDS } from "@/lib/personas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Single Claude call + optional compress retry. Well under Vercel's cap.
export const maxDuration = 60;

const Body = z.object({
  hookText: z.string().min(1).max(2000),
  personaId: z.enum(PERSONA_IDS as [string, ...string[]]),
  model: z.string().refine(isModelId, { message: "invalid model" }),
  notes: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
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
    let out = await generateInstagramCaption({
      hookText: parsed.hookText,
      personaId: parsed.personaId as (typeof PERSONA_IDS)[number],
      model: parsed.model,
      notes: parsed.notes,
    });

    const MAX_COMPRESS_ATTEMPTS = 2;
    let compressAttempts = 0;
    while (
      out.charCount > INSTAGRAM_CHAR_CEILING &&
      compressAttempts < MAX_COMPRESS_ATTEMPTS
    ) {
      compressAttempts++;
      out = await compressInstagramCaption({
        oversizedCaption: out.caption,
        personaId: parsed.personaId as (typeof PERSONA_IDS)[number],
        model: parsed.model,
      });
    }

    if (out.charCount > INSTAGRAM_CHAR_CEILING) {
      return NextResponse.json(
        {
          ok: false,
          error: `Could not fit caption under ${INSTAGRAM_CHAR_CEILING} characters after ${MAX_COMPRESS_ATTEMPTS} retries (last: ${out.charCount}).`,
          charCount: out.charCount,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      caption: out.caption,
      charCount: out.charCount,
      model: parsed.model,
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
    endpoint: "POST /api/generate/caption/instagram",
    models: [MODELS.SONNET_4_6, MODELS.OPUS_4_7],
    body: {
      hookText: "string",
      personaId: "andrea | emma | olivia | mia | abby | diane | sydney | maddy",
      model: "claude-sonnet-4-6 | claude-opus-4-7",
      notes: "optional string",
    },
    ceiling: INSTAGRAM_CHAR_CEILING,
  });
}
