/**
 * Dashboard wrapper around `submitImageBatch`. Same auth as the rest
 * of /api/image-studio/*. Each item carries the same shape as
 * `generate_image` arguments. Returns a batch_id immediately; the
 * Image Studio Batches panel auto-polls /api/image-studio/batch/[id]
 * until status is terminal.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { ASPECT_RATIOS, RateLimitError } from "@/lib/image-generation";
import {
  submitImageBatch,
  type BatchItemInput,
} from "@/lib/image-generation-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Item = z.object({
  prompt: z.string().min(1).max(2000),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
  referenceImageUrl: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "must be http(s)")
    .optional(),
  referenceImageBase64: z.string().max(11_000_000).optional(),
  referenceImageMimeType: z
    .enum(["image/png", "image/jpeg", "image/webp", "image/gif"])
    .optional(),
});

const Body = z.object({
  items: z.array(Item).min(1).max(100),
  displayName: z.string().max(200).optional(),
  // Shared reference image fan-out. The dashboard sends the heavy
  // base64 once here instead of duplicating it per item, so the
  // payload doesn't blow past the serverless body-size cap when
  // count > 1. Server expands these into each item that doesn't
  // already carry its own reference.
  sharedReferenceImageBase64: z.string().max(11_000_000).optional(),
  sharedReferenceImageMimeType: z
    .enum(["image/png", "image/jpeg", "image/webp", "image/gif"])
    .optional(),
});

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
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
    const sharedB64 = parsed.sharedReferenceImageBase64;
    const sharedMime = parsed.sharedReferenceImageMimeType;
    const items: BatchItemInput[] = parsed.items.map((it) => {
      const hasOwnRef =
        it.referenceImageUrl != null || it.referenceImageBase64 != null;
      return {
        prompt: it.prompt,
        aspectRatio: it.aspectRatio,
        referenceImageUrl: it.referenceImageUrl,
        referenceImageBase64:
          it.referenceImageBase64 ?? (hasOwnRef ? undefined : sharedB64),
        referenceImageMimeType:
          it.referenceImageMimeType ?? (hasOwnRef ? undefined : sharedMime),
      };
    });
    const summary = await submitImageBatch({
      items,
      source: "dashboard",
      displayName: parsed.displayName,
    });
    return NextResponse.json({ ok: true, batch: summary });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        {
          ok: false,
          error: err.message,
          window: err.window,
          limit: err.limit,
        },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
