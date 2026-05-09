/**
 * Per-avatar mutations: upload (PUT) or clear (DELETE) the reference
 * image for a single named slot. Same auth gate as /api/image-studio.
 *
 * The dashboard PUTs base64 + mime (mirroring the resource-image
 * upload pattern in src/lib/supabase.ts:createResourceImage). The
 * server decodes the bytes, replaces any existing blob, and stamps
 * the new public URL onto the row.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { isAvatarId } from "@/lib/avatars";
import {
  clearAvatarImage,
  setAvatarImage,
} from "@/lib/avatars-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PutBody = z.object({
  image_base64: z.string().min(1).max(11_000_000),
  image_mime: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
});

function decodeBase64(b64: string): ArrayBuffer {
  const buf = Buffer.from(b64, "base64");
  // Slice off any extra bytes Buffer may have allocated beyond byteLength.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  const { name } = await ctx.params;
  if (!isAvatarId(name)) {
    return NextResponse.json(
      { ok: false, error: `unknown avatar: ${name}` },
      { status: 400 },
    );
  }
  let parsed: z.infer<typeof PutBody>;
  try {
    parsed = PutBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
  try {
    const bytes = decodeBase64(parsed.image_base64);
    const avatar = await setAvatarImage(name, bytes, parsed.image_mime);
    return NextResponse.json({ ok: true, avatar });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  const { name } = await ctx.params;
  if (!isAvatarId(name)) {
    return NextResponse.json(
      { ok: false, error: `unknown avatar: ${name}` },
      { status: 400 },
    );
  }
  try {
    const avatar = await clearAvatarImage(name);
    return NextResponse.json({ ok: true, avatar });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
