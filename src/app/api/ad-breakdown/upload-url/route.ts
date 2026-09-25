/**
 * Signed Storage upload for pre-flight videos. Vercel caps request bodies
 * at 4.5 MB and a 4K master runs 40-90 MB, so the browser PUTs straight to
 * Supabase Storage with a one-shot signed URL, then POSTs the path to
 * /api/ad-breakdown.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { storageBucket, storageConfigured } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";
/** Supabase Storage rejects larger objects with a bare 400 (a 114 MB master
 *  hit it on 2026-09-25; 28 MB went through), so refuse early with a hint. */
const MAX_BYTES = 50 * 1024 * 1024;
const EXT: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

const Body = z.object({
  filename: z.string().min(1).max(200),
  content_type: z.string().min(1),
  size: z
    .number()
    .int()
    .positive()
    .max(MAX_BYTES, { message: "Storage takes files up to 50 MB; export a 720p proxy for anything larger" }),
});

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!storageConfigured()) return NextResponse.json({ error: "storage not configured" }, { status: 503 });
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json().catch(() => ({})));
  } catch (e) {
    const msg = e instanceof z.ZodError ? (e.issues[0]?.message ?? "invalid body") : e instanceof Error ? e.message : "invalid body";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const ext = EXT[body.content_type];
  if (!ext) return NextResponse.json({ error: "upload an mp4, mov or webm" }, { status: 400 });

  const bucket = storageBucket();
  const path = `ad-breakdowns/uploads/${crypto.randomUUID()}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${bucket}/${path}`, {
    method: "POST",
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    return NextResponse.json({ error: `signed upload failed: ${res.status} ${await res.text()}` }, { status: 500 });
  }
  const { url } = (await res.json()) as { url: string };
  return NextResponse.json({
    path,
    upload_url: `${SUPABASE_URL}/storage/v1${url}`,
    public_url: `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`,
    name: body.filename.replace(/\.[^.]+$/, ""),
  });
}
