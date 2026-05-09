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

const Body = z.object({
  prompt: z.string().min(1).max(2000),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
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
    if (count === 1) {
      const result = await generateImage({
        prompt: parsed.prompt,
        aspectRatio: parsed.aspectRatio,
        referenceImageUrl: parsed.referenceImageUrl,
        referenceImageBase64: parsed.referenceImageBase64,
        referenceImageMimeType: parsed.referenceImageMimeType,
        source: "dashboard",
      });
      // Single-image response keeps `result` for back-compat; also expose
      // `results` so the UI can use one shape.
      return NextResponse.json({ ok: true, result, results: [result] });
    }
    const results = await generateImageBatch({
      prompt: parsed.prompt,
      aspectRatio: parsed.aspectRatio,
      referenceImageUrl: parsed.referenceImageUrl,
      referenceImageBase64: parsed.referenceImageBase64,
      referenceImageMimeType: parsed.referenceImageMimeType,
      source: "dashboard",
      count,
    });
    return NextResponse.json({ ok: true, result: results[0], results });
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
