import { NextResponse } from "next/server";
import { z } from "zod";
import {
  generateBeforeTransformationCaption,
  captionGeneratorConfigured,
  BEFORE_TRANSFORMATION_CHAR_CEILING,
} from "@/lib/caption-generator";
import { isModelId, MODELS } from "@/lib/models";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { PERSONA_IDS, type PersonaId } from "@/lib/personas";
import { PERSONA_PROFILES } from "@/lib/persona-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  personaId: z.enum(PERSONA_IDS as [string, ...string[]]),
  model: z.string().refine(isModelId, { message: "invalid model" }),
  startWeightLbs: z.number().int().positive().max(700).optional(),
  goalWeightLbs: z.number().int().positive().max(700).optional(),
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
    const out = await generateBeforeTransformationCaption({
      personaId: parsed.personaId as PersonaId,
      model: parsed.model,
      overrides: {
        startWeightLbs: parsed.startWeightLbs,
        goalWeightLbs: parsed.goalWeightLbs,
        notes: parsed.notes,
      },
    });

    if (out.charCount > BEFORE_TRANSFORMATION_CHAR_CEILING) {
      return NextResponse.json(
        {
          ok: false,
          error: `Generated caption exceeded ${BEFORE_TRANSFORMATION_CHAR_CEILING} characters (${out.charCount}).`,
          caption: out.caption,
          charCount: out.charCount,
        },
        { status: 500 },
      );
    }

    const profile = PERSONA_PROFILES[parsed.personaId as PersonaId];
    return NextResponse.json({
      ok: true,
      caption: out.caption,
      charCount: out.charCount,
      model: parsed.model,
      persona: {
        id: profile.id,
        name: profile.name,
        age: profile.age,
        archetype: profile.archetype,
        startWeightLbs: parsed.startWeightLbs ?? profile.startWeightLbs,
        goalWeightLbs: parsed.goalWeightLbs ?? profile.goalWeightLbs,
      },
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
    endpoint: "POST /api/generate/caption/before-transformation",
    models: [MODELS.SONNET_4_6, MODELS.OPUS_4_7],
    body: {
      personaId: "andrea | emma | olivia | mia | abby | diane | sydney | maddy",
      model: "claude-sonnet-4-6 | claude-opus-4-7",
      startWeightLbs: "optional integer (overrides persona default)",
      goalWeightLbs: "optional integer (overrides persona default)",
      notes: "optional string",
    },
    ceiling: BEFORE_TRANSFORMATION_CHAR_CEILING,
  });
}
