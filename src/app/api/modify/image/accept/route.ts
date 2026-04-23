import { NextResponse } from "next/server";
import { z } from "zod";
import { isPersonaId } from "@/lib/personas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";
const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? "dreamme-admin-internal-images";

const Body = z.object({
  deliveryId: z.string().uuid(),
  personaId: z.string().min(1),
  imageBase64: z.string().min(1),
  mimeType: z.string().default("image/png"),
});

function extFromMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  return "png";
}

async function uploadBytes(
  bytes: Buffer,
  path: string,
  contentType: string,
): Promise<string> {
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body,
    },
  );
  if (!res.ok) {
    throw new Error(`Storage upload failed: ${res.status} ${await res.text()}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

async function patchDelivery(id: string, imageUrl: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/deliveries?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ image_url: imageUrl }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Supabase deliveries patch failed: ${res.status} ${await res.text()}`,
    );
  }
}

export async function POST(req: Request) {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured" },
      { status: 500 },
    );
  }
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 400 },
    );
  }
  if (!isPersonaId(parsed.personaId)) {
    return NextResponse.json(
      { ok: false, error: "bad personaId" },
      { status: 400 },
    );
  }

  try {
    const mime =
      parsed.mimeType.includes("jpeg") || parsed.mimeType.includes("jpg")
        ? "image/jpeg"
        : "image/png";
    const ext = extFromMime(mime);
    const clean = parsed.imageBase64.replace(/^data:[^;]+;base64,/, "");
    const bytes = Buffer.from(clean, "base64");
    const uniq = crypto.randomUUID().slice(0, 8);
    const path = `${parsed.personaId}/modified-${Date.now()}-${uniq}.${ext}`;
    const newUrl = await uploadBytes(bytes, path, mime);
    await patchDelivery(parsed.deliveryId, newUrl);
    return NextResponse.json({ ok: true, imageUrl: newUrl });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
