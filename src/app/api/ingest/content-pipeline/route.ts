import { NextResponse } from "next/server";
import { z } from "zod";
import { isPersonaId } from "@/lib/personas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";
const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? "dreamme-admin-internal-images";
const INGEST_SECRET = process.env.INGEST_TOKEN ?? "";

const ItemSchema = z
  .object({
    persona: z.enum(["andrea", "emma", "olivia", "mia", "abby", "diane", "sydney", "maddy", "hannah", "hailey", "taylor", "max", "ava", "rachel", "sarah", "jessica", "alex", "maya", "jess"]),
    caption: z.string().optional(),
    image_url: z.string().url().optional(),
    image_base64: z.string().min(1).optional(),
    image_mime: z.string().optional(),
    is_before: z.boolean().optional().default(false),
  })
  .refine((v) => !!v.image_url || !!v.image_base64, {
    message: "Provide either image_url or image_base64",
  })
  .refine((v) => v.is_before || (v.caption && v.caption.length > 0), {
    message: "caption is required when is_before is false",
    path: ["caption"],
  });

const Payload = z.union([
  ItemSchema,
  z.object({
    items: z.array(ItemSchema).min(1),
    caption: z.string().optional(),
  }),
]);

function unauthorized(msg = "unauthorized") {
  return NextResponse.json({ ok: false, error: msg }, { status: 401 });
}

function badRequest(msg: string, extra?: unknown) {
  return NextResponse.json(
    { ok: false, error: msg, details: extra },
    { status: 400 },
  );
}

function checkAuth(req: Request) {
  if (!INGEST_SECRET) return false;
  const header =
    req.headers.get("x-dreamme-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  return header === INGEST_SECRET;
}

function extOf(mime: string | undefined, url: string | undefined) {
  if (mime?.includes("jpeg") || mime?.includes("jpg")) return "jpg";
  if (mime?.includes("webp")) return "webp";
  if (mime?.includes("gif")) return "gif";
  if (url) {
    const m = url.match(/\.(png|jpe?g|webp|gif)(\?|$)/i);
    if (m) return m[1].toLowerCase().replace("jpeg", "jpg");
  }
  return "png";
}

async function uploadBytes(
  bytes: ArrayBuffer | Uint8Array,
  path: string,
  contentType: string,
): Promise<string> {
  const body: BodyInit =
    bytes instanceof Uint8Array
      ? (bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer)
      : bytes;
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

async function ingestOne(
  raw: z.infer<typeof ItemSchema>,
  sharedCaption?: string,
) {
  const isBefore = !!raw.is_before;
  const caption = isBefore ? (raw.caption ?? "") : (raw.caption ?? sharedCaption ?? "");
  if (!isBefore && !caption) throw new Error("caption missing");
  if (!isPersonaId(raw.persona)) throw new Error("bad persona");

  const pathPrefix = isBefore ? `before/${raw.persona}` : raw.persona;

  let imageUrl = raw.image_url ?? "";

  if (raw.image_base64) {
    const clean = raw.image_base64.replace(/^data:[^;]+;base64,/, "");
    const bytes = Buffer.from(clean, "base64");
    const mime = raw.image_mime ?? "image/png";
    const ext = extOf(mime, undefined);
    const path = `${pathPrefix}/${Date.now()}-${crypto
      .randomUUID()
      .slice(0, 8)}.${ext}`;
    imageUrl = await uploadBytes(bytes, path, mime);
  } else if (raw.image_url) {
    // Re-upload so we control the lifetime of the asset
    const resp = await fetch(raw.image_url);
    if (!resp.ok)
      throw new Error(`Fetching image_url failed: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const mime = resp.headers.get("content-type") ?? "image/png";
    const ext = extOf(mime, raw.image_url);
    const path = `${pathPrefix}/${Date.now()}-${crypto
      .randomUUID()
      .slice(0, 8)}.${ext}`;
    imageUrl = await uploadBytes(buf, path, mime);
  }

  const insert = await fetch(`${SUPABASE_URL}/rest/v1/deliveries`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      persona: raw.persona,
      caption,
      image_url: imageUrl,
      is_before: isBefore,
    }),
  });
  if (!insert.ok) {
    throw new Error(
      `Insert failed: ${insert.status} ${await insert.text()}`,
    );
  }
  const rows = await insert.json();
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function POST(req: Request) {
  if (!checkAuth(req)) return unauthorized();
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Server misconfigured - missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }

  const parsed = Payload.safeParse(body);
  if (!parsed.success) return badRequest("invalid payload", parsed.error.flatten());

  const items = "items" in parsed.data ? parsed.data.items : [parsed.data];
  const sharedCaption =
    "items" in parsed.data ? parsed.data.caption : undefined;

  try {
    const rows = [];
    for (const it of items) {
      rows.push(await ingestOne(it, sharedCaption));
    }
    return NextResponse.json({ ok: true, inserted: rows.length, rows });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/ingest/content-pipeline",
    auth: "send X-DreamMe-Secret (or Authorization: Bearer <INGEST_TOKEN>)",
    schema: {
      single: {
        persona: "andrea | emma | olivia | mia | abby | diane | sydney | maddy | hannah | hailey | taylor | max | ava | rachel | sarah | jessica | alex | maya | jess",
        caption: "string (required unless is_before=true)",
        image_url: "string (optional)",
        image_base64: "string (optional)",
        image_mime: "string (optional, default image/png)",
        is_before: "boolean (optional, default false) - marks this as a before photo for transformation posts",
      },
      batched: {
        caption: "optional fallback for items without caption",
        items: "Array of single shape",
      },
    },
  });
}
