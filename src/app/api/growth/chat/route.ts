/**
 * Growth AI analyst chat — Runneth-style "ask it anything" over DreamMe's
 * paid-social + RevenueCat data. Runs a bounded Claude tool-use loop with
 * the read-only tools in src/lib/growth-tools.ts and returns the final
 * markdown reply plus a per-tool activity trace for the UI.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { MODELS, isModelId } from "@/lib/models";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { runGrowthAgent } from "@/lib/growth-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(20_000),
      }),
    )
    .min(1)
    .max(40),
  model: z.string().optional(),
});

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid body" },
      { status: 400 },
    );
  }

  const model = body.model && isModelId(body.model) ? body.model : MODELS.SONNET_4_6;

  try {
    const result = await runGrowthAgent({ messages: body.messages, model });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
