/**
 * Ad breakdown — frames + transcript + Gemini listen + Motion-rubric
 * pre-flight, aligned to Meta's retention points. POST runs (or returns the
 * cached row); GET reads. The pipeline lives in src/lib/ad-breakdown.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { geminiKey } from "@/lib/ad-breakdown/gemini";
import { runBreakdown, getBreakdown, getBreakdownById, listBreakdowns } from "@/lib/ad-breakdown/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z
  .object({
    ad_id: z.string().regex(/^\d{6,}$/).optional(),
    upload_path: z.string().regex(/^ad-breakdowns\/uploads\/[A-Za-z0-9._-]+$/).optional(),
    name: z.string().max(200).optional(),
    days: z.number().int().min(1).max(90).optional(),
    force: z.boolean().optional(),
  })
  .refine((b) => !!b.ad_id !== !!b.upload_path, { message: "pass exactly one of ad_id or upload_path" });

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!geminiKey()) {
    return NextResponse.json({ error: "No Gemini key configured (GOOGLE_API_KEY)" }, { status: 503 });
  }
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json().catch(() => ({})));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "invalid body" }, { status: 400 });
  }
  try {
    const row = await runBreakdown({
      adId: body.ad_id,
      uploadPath: body.upload_path,
      name: body.name,
      days: body.days,
      force: body.force,
    });
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  try {
    const id = url.searchParams.get("id");
    if (id) return NextResponse.json((await getBreakdownById(id)) ?? null);
    const adId = url.searchParams.get("ad_id");
    if (adId) return NextResponse.json((await getBreakdown("meta_ad", adId)) ?? null);
    const uploadPath = url.searchParams.get("upload_path");
    if (uploadPath) return NextResponse.json((await getBreakdown("upload", uploadPath)) ?? null);
    const kind = url.searchParams.get("kind") === "upload" ? "upload" : "meta_ad";
    const limit = Math.min(100, Number(url.searchParams.get("limit")) || 30);
    return NextResponse.json({ rows: await listBreakdowns(kind, limit) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
