/**
 * Accessory Studio step 3: Recraft vectorize a standalone raster and return
 * the cleaned SVG text. Normalizing onto the 1920x1080 frame happens in the
 * browser because it needs getBBox().
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { recraftConfigured, vectorizeImage } from "@/lib/accessory-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  imageUrl: z.string().url().refine((u) => /^https?:\/\//i.test(u), "must be http(s)"),
});

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!recraftConfigured()) {
    return NextResponse.json({ ok: false, error: "RECRAFT_API_KEY is not set on this deployment" }, { status: 500 });
  }
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 400 });
  }
  try {
    const svg = await vectorizeImage(body.imageUrl);
    return NextResponse.json({ ok: true, svg });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
