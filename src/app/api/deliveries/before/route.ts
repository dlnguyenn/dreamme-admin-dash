import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { isPersonaId } from "@/lib/personas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";
const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? "dreamme-admin-internal-images";

const Body = z.object({
  persona: z.enum([
    "andrea",
    "emma",
    "olivia",
    "mia",
    "abby",
    "diane",
    "sydney",
    "maddy",
  ]),
  image_base64: z.string().min(1),
  image_mime: z.string().optional(),
  // Optional short label shown under the card in the library, e.g.
  // "Bedroom mirror" when a generated photo is kept. Stored in the
  // existing `caption` column (empty for legacy manual uploads).
  caption: z.string().max(120).optional(),
});

function extOf(mime: string | undefined): string {
  if (mime?.includes("jpeg") || mime?.includes("jpg")) return "jpg";
  if (mime?.includes("webp")) return "webp";
  if (mime?.includes("gif")) return "gif";
  return "png";
}

async function uploadBytes(
  bytes: Uint8Array,
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

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Server misconfigured - missing NEXT_PUBLIC_SUPABASE_URL or DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY",
      },
      { status: 500 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    );
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { persona, image_base64, image_mime, caption } = parsed.data;
  if (!isPersonaId(persona)) {
    return NextResponse.json(
      { ok: false, error: "bad persona" },
      { status: 400 },
    );
  }

  try {
    const clean = image_base64.replace(/^data:[^;]+;base64,/, "");
    const bytes = Buffer.from(clean, "base64");
    const mime = image_mime ?? "image/png";
    const ext = extOf(mime);
    const shortId = crypto.randomUUID().slice(0, 8);
    const path = `before/${persona}/${Date.now()}-${shortId}.${ext}`;
    const imageUrl = await uploadBytes(bytes, path, mime);

    const insert = await fetch(`${SUPABASE_URL}/rest/v1/deliveries`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        persona,
        caption: caption ?? "",
        image_url: imageUrl,
        is_before: true,
      }),
    });
    if (!insert.ok) {
      throw new Error(
        `Insert failed: ${insert.status} ${await insert.text()}`,
      );
    }
    const rows = await insert.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
