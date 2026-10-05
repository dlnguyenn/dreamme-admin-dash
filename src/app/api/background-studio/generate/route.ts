/**
 * Background Studio generation.
 *   new  — a fresh background from a name + theme, with the style and
 *          layout references
 *   edit — revise an existing background with a one-line instruction
 *          (e.g. "flood the cabin to the ceiling"), everything else kept
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { RateLimitError, generateImage, imageGenerationConfigured } from "@/lib/image-generation";
import { editBackgroundPrompt, newBackgroundPrompt, refUrls } from "@/lib/background-studio";
import { BG_MODELS } from "@/lib/background-studio-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const httpUrl = z.string().url().refine((u) => /^https?:\/\//i.test(u), "must be http(s)");

const Body = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new"),
    name: z.string().trim().min(1).max(80),
    theme: z.string().trim().min(1).max(800),
    model: z.enum(["pro", "flash"]).default("pro"),
  }),
  z.object({
    mode: z.literal("edit"),
    sourceUrl: httpUrl,
    instruction: z.string().trim().min(1).max(600),
    model: z.enum(["pro", "flash"]).default("pro"),
  }),
]);

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!imageGenerationConfigured()) {
    return NextResponse.json({ ok: false, error: "image generation not configured" }, { status: 500 });
  }
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }

  const prompt = body.mode === "new" ? newBackgroundPrompt(body.name, body.theme) : editBackgroundPrompt(body.instruction);
  const referenceImages = body.mode === "new" ? refUrls().map((url) => ({ url })) : [{ url: body.sourceUrl }];

  try {
    const result = await generateImage({
      prompt,
      aspectRatio: "9:16",
      imageSize: "2K",
      referenceImages,
      model: BG_MODELS[body.model],
      usageRoute: "/api/background-studio/generate",
      source: "dashboard",
      timeoutMs: 240_000,
    });
    return NextResponse.json({ ok: true, imageUrl: result.imageUrl, model: result.geminiModel });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 429 });
    }
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
