/**
 * Accessory Studio raster steps. One call per step so the UI can show and
 * redo each stage:
 *   onfish  — Dan's prompt + Sushi (sent inline by the client)
 *   extract — edit the on-fish image: delete the fish, keep the item
 *   match   — standalone item copying a reference accessory's silhouette
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { RateLimitError, generateImage, imageGenerationConfigured } from "@/lib/image-generation";
import { extractPrompt, matchPrompt, onFishPrompt } from "@/lib/accessory-studio";
import { ACCESSORY_MODELS, ACCESSORY_SLOTS } from "@/lib/accessory-studio-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Ref = z.union([
  z.object({ url: z.string().url().refine((u) => /^https?:\/\//i.test(u), "must be http(s)") }),
  z.object({
    base64: z.string().max(11_000_000),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  }),
]);

const Body = z.object({
  step: z.enum(["onfish", "extract", "match"]),
  item: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(600),
  slot: z.enum(ACCESSORY_SLOTS),
  model: z.enum(["flash", "pro"]).default("flash"),
  reference: Ref,
});

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

  const prompt =
    body.step === "onfish"
      ? onFishPrompt(body.item, body.subject, body.slot)
      : body.step === "extract"
        ? extractPrompt(body.item)
        : matchPrompt(body.item, body.subject);

  try {
    const result = await generateImage({
      prompt,
      aspectRatio: "1:1",
      // 1K is plenty for vectorizing and keeps each step fast.
      imageSize: "1K",
      referenceImages: [body.reference],
      model: ACCESSORY_MODELS[body.model],
      usageRoute: "/api/accessory-studio/generate",
      source: "dashboard",
      timeoutMs: 240_000,
    });
    return NextResponse.json({ ok: true, imageUrl: result.imageUrl, prompt });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 429 });
    }
    const message = (err as Error).message;
    // Gemini will draw licensed characters on the fish but refuses to edit
    // them back out. Point at the workaround instead of a bare filter error.
    const hint =
      body.step === "extract" && /filtered|PROHIBITED|blocked/i.test(message)
        ? " Gemini refused this edit (common for licensed characters). Use Match existing with a similar accessory instead."
        : "";
    return NextResponse.json({ ok: false, error: message + hint }, { status: 500 });
  }
}
