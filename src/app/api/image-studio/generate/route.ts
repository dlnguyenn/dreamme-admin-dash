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
  imageGenerationConfigured,
} from "@/lib/image-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  prompt: z.string().min(1).max(2000),
  aspectRatio: z.enum(ASPECT_RATIOS).optional(),
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
    const result = await generateImage({
      prompt: parsed.prompt,
      aspectRatio: parsed.aspectRatio,
      source: "dashboard",
    });
    return NextResponse.json({ ok: true, result });
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
