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

const PERSONA_ENUM = [
  "andrea",
  "emma",
  "olivia",
  "mia",
  "abby",
  "diane",
  "sydney",
  "maddy",
  "hannah",
] as const;

const PostBody = z.object({
  persona: z.enum(PERSONA_ENUM),
  image_base64: z.string().min(1),
  image_mime: z.string().optional(),
});

const DeleteBody = z.object({
  path: z.string().min(1),
});

function extOf(mime: string | undefined): string {
  if (mime?.includes("jpeg") || mime?.includes("jpg")) return "jpg";
  if (mime?.includes("webp")) return "webp";
  if (mime?.includes("gif")) return "gif";
  return "png";
}

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function misconfigured() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Server misconfigured - missing NEXT_PUBLIC_SUPABASE_URL or DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY",
    },
    { status: 500 },
  );
}

function publicUrlFor(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
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
  return publicUrlFor(path);
}

interface StorageObject {
  name: string;
  id?: string | null;
  updated_at?: string;
  created_at?: string;
  metadata?: { size?: number; mimetype?: string } | null;
}

async function listObjects(prefix: string): Promise<StorageObject[]> {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prefix,
        limit: 200,
        offset: 0,
        sortBy: { column: "created_at", order: "desc" },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Storage list failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as StorageObject[];
  // Filter out folder placeholders (object with id=null and name starting with "" etc.)
  return data.filter((o) => o.id !== null && o.name && !o.name.endsWith("/"));
}

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) return unauthorized();
  if (!SUPABASE_URL || !SERVICE_ROLE) return misconfigured();

  const { searchParams } = new URL(req.url);
  const persona = searchParams.get("persona") ?? "";
  if (!isPersonaId(persona)) {
    return NextResponse.json(
      { ok: false, error: "bad or missing persona" },
      { status: 400 },
    );
  }

  try {
    const prefix = `reference/${persona}`;
    const objects = await listObjects(prefix);
    const items = objects.map((o) => {
      const path = `${prefix}/${o.name}`;
      return { path, url: publicUrlFor(path) };
    });
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) return unauthorized();
  if (!SUPABASE_URL || !SERVICE_ROLE) return misconfigured();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    );
  }

  const parsed = PostBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { persona, image_base64, image_mime } = parsed.data;

  try {
    const clean = image_base64.replace(/^data:[^;]+;base64,/, "");
    const bytes = Buffer.from(clean, "base64");
    const mime = image_mime ?? "image/png";
    const ext = extOf(mime);
    const shortId = crypto.randomUUID().slice(0, 8);
    const path = `reference/${persona}/${Date.now()}-${shortId}.${ext}`;
    const url = await uploadBytes(bytes, path, mime);
    return NextResponse.json({ ok: true, path, url });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  if (!checkIngestAuth(req)) return unauthorized();
  if (!SUPABASE_URL || !SERVICE_ROLE) return misconfigured();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    );
  }

  const parsed = DeleteBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { path } = parsed.data;
  // Defensive: only allow paths under reference/
  if (!path.startsWith("reference/")) {
    return NextResponse.json(
      { ok: false, error: "path must be under reference/" },
      { status: 400 },
    );
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
      {
        method: "DELETE",
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
        },
      },
    );
    if (!res.ok) {
      throw new Error(
        `Storage delete failed: ${res.status} ${await res.text()}`,
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
