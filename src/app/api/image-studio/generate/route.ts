/**
 * Dashboard-side wrapper around `generateImage`. The Image Studio panel
 * calls this so the MCP bearer token never has to touch the browser.
 * Gated by `checkIngestAuth` which permits same-origin calls from the
 * password-gated dash UI.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  ASPECT_RATIOS,
  RateLimitError,
  generateImage,
  generateImageBatch,
  imageGenerationConfigured,
} from "@/lib/image-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RefInputSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "must be http(s)")
    .optional(),
  base64: z.string().max(11_000_000).optional(),
  mimeType: z
    .enum(["image/png", "image/jpeg", "image/webp", "image/gif"])
    .optional(),
});

const Body = z.object({
  prompt: z.string().min(1).max(2000),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
  // Up to 4 references (URL or inline base64). Preferred over the single
  // referenceImage* fields below, which are kept for back-compat.
  referenceImages: z.array(RefInputSchema).max(4).optional(),
  referenceImageUrl: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "must be http(s)")
    .optional(),
  // Optional inline reference image as base64 — used by the file-picker
  // in the dashboard UI so we don't have to host the upload separately.
  // Capped at ~10 MB encoded (~7.5 MB decoded) to match the
  // REFERENCE_MAX_BYTES guard inside generateImage.
  referenceImageBase64: z.string().max(11_000_000).optional(),
  referenceImageMimeType: z
    .enum(["image/png", "image/jpeg", "image/webp", "image/gif"])
    .optional(),
  count: z.number().int().min(1).max(8).optional(),
});

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!imageGenerationConfigured()) {
    return NextResponse.json(
      { ok: false, error: "image generation not configured" },
      { status: 500 },
    );
  }
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
  try {
    const count = parsed.count ?? 1;
    // gemini-3.1-flash-image-preview routinely takes 40-120 s on
    // image-edit calls with detailed prompts; the default 60 s
    // timeout in `generateImage` was aborting legitimate slow
    // responses. Vercel `maxDuration` on this route is 300 s, the
    // MCP path already uses 240 s — match it here for consistency.
    const PER_ITEM_TIMEOUT_MS = 240_000;
    if (count === 1) {
      const result = await generateImage({
        prompt: parsed.prompt,
        aspectRatio: parsed.aspectRatio,
        referenceImages: parsed.referenceImages,
        referenceImageUrl: parsed.referenceImageUrl,
        referenceImageBase64: parsed.referenceImageBase64,
        referenceImageMimeType: parsed.referenceImageMimeType,
        source: "dashboard",
        timeoutMs: PER_ITEM_TIMEOUT_MS,
      });
      // Single-image response keeps `result` for back-compat; also expose
      // `results` so the UI can use one shape.
      return NextResponse.json({ ok: true, result, results: [result] });
    }
    const { results, errors } = await generateImageBatch({
      prompt: parsed.prompt,
      aspectRatio: parsed.aspectRatio,
      referenceImages: parsed.referenceImages,
      referenceImageUrl: parsed.referenceImageUrl,
      referenceImageBase64: parsed.referenceImageBase64,
      referenceImageMimeType: parsed.referenceImageMimeType,
      source: "dashboard",
      count,
      timeoutMs: PER_ITEM_TIMEOUT_MS,
    });
    // All-or-nothing failure preserves today's 500-on-failure contract.
    // Otherwise return 200 with whatever succeeded plus a per-index
    // errors array so the UI can render a partial-failure banner.
    if (results.length === 0 && errors.length > 0) {
      return NextResponse.json(
        { ok: false, error: errors[0].error, errors },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      result: results[0],
      results,
      errors,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { ok: false, error: err.message, window: err.window, limit: err.limit },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
