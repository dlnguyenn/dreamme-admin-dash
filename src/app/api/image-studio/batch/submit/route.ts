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
import { ASPECT_RATIOS, IMAGE_SIZES, RateLimitError } from "@/lib/image-generation";
import {
  submitImageBatch,
  type BatchItemInput,
} from "@/lib/image-generation-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  role: z.enum(["identity", "pose", "plain"]).optional(),
});

const Item = z.object({
  prompt: z.string().min(1).max(2000),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
  // Output resolution. Omitted → the lib default ("2K").
  imageSize: z.enum(IMAGE_SIZES).optional(),
  // Up to 4 references per item. Preferred over the single fields below.
  referenceImages: z.array(RefInputSchema).max(4).optional(),
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
  // Avatar/pose slugs chosen in the UI, shared across every item in the
  // batch (the form has one selection). Persisted per generated row for
  // `avatar_pose_###` download naming.
  avatar: z.string().max(64).optional(),
  pose: z.string().max(64).optional(),
  // Shared reference fan-out. The dashboard sends the heavy base64 once
  // here instead of duplicating it per item, so the payload doesn't blow
  // past the serverless body-size cap when count > 1. The server expands
  // these into each item that doesn't already carry its own references.
  sharedReferenceImages: z.array(RefInputSchema).max(4).optional(),
  // Legacy single shared reference (kept for back-compat).
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
    // Resolve the shared reference set once. Prefer the array form;
    // fall back to the legacy single shared base64.
    const sharedRefs =
      parsed.sharedReferenceImages && parsed.sharedReferenceImages.length > 0
        ? parsed.sharedReferenceImages
        : parsed.sharedReferenceImageBase64
          ? [
              {
                base64: parsed.sharedReferenceImageBase64,
                mimeType: parsed.sharedReferenceImageMimeType,
              },
            ]
          : undefined;
    const items: BatchItemInput[] = parsed.items.map((it) => {
      const hasOwnRef =
        (it.referenceImages != null && it.referenceImages.length > 0) ||
        it.referenceImageUrl != null ||
        it.referenceImageBase64 != null;
      return {
        prompt: it.prompt,
        aspectRatio: it.aspectRatio,
        imageSize: it.imageSize,
        // Item-level refs win; otherwise fan out the shared set.
        referenceImages: hasOwnRef
          ? it.referenceImages
          : sharedRefs,
        referenceImageUrl: it.referenceImageUrl,
        referenceImageBase64: it.referenceImageBase64,
        referenceImageMimeType: it.referenceImageMimeType,
        avatar: parsed.avatar ?? null,
        pose: parsed.pose ?? null,
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
