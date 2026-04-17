import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { PERSONA_BUCKET } from "@/lib/storage";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const PERSONA_SLUGS = ["andrea", "emma", "olivia"] as const;

const ItemSchema = z
  .object({
    persona: z.enum(PERSONA_SLUGS),
    image_base64: z.string().min(1).optional(),
    image_url: z.string().url().optional(),
    image_mime: z.string().optional(),
  })
  .refine((v) => v.image_base64 || v.image_url, {
    message: "Provide image_base64 or image_url",
  });

const PayloadSchema = z.object({
  run_id: z.string().optional(),
  triggered_by: z.string().optional(),
  caption: z.string().min(1),
  tags: z.array(z.string()).optional(),
  items: z.array(ItemSchema).min(1).max(3),
});

function unauthorized(msg = "Unauthorized") {
  return NextResponse.json({ error: msg }, { status: 401 });
}

function stripBase64Prefix(b64: string): { data: string; mime: string | null } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(b64);
  if (m) return { data: m[2], mime: m[1] };
  return { data: b64, mime: null };
}

function extFromMime(mime: string | null | undefined): string {
  switch ((mime ?? "").toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "png";
  }
}

async function fetchImage(url: string): Promise<{ buffer: Buffer; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const mime = res.headers.get("content-type") ?? "image/png";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mime };
}

export async function POST(request: NextRequest) {
  // ---- Auth (shared bearer token with N8N) ----
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (!token || token !== env.ingestToken()) return unauthorized();

  // ---- Parse + validate ----
  let parsed: z.infer<typeof PayloadSchema>;
  try {
    const raw = await request.json();
    parsed = PayloadSchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid payload",
        details: err instanceof z.ZodError ? err.issues : String(err),
      },
      { status: 400 },
    );
  }

  const svc = createSupabaseServiceClient();
  const now = new Date().toISOString();

  // ---- workflow_runs ----
  const { data: run, error: runErr } = await svc
    .from("workflow_runs")
    .insert({
      n8n_execution_id: parsed.run_id ?? null,
      triggered_by: parsed.triggered_by ?? "n8n",
      status: "completed",
      started_at: now,
      finished_at: now,
    })
    .select("id")
    .single();
  if (runErr || !run) {
    return NextResponse.json(
      { error: "Failed to create run", details: runErr?.message },
      { status: 500 },
    );
  }

  // ---- caption ----
  const { data: caption, error: captionErr } = await svc
    .from("captions")
    .insert({
      text: parsed.caption,
      source_run_id: run.id,
      tags: parsed.tags ?? [],
    })
    .select("id")
    .single();
  if (captionErr || !caption) {
    return NextResponse.json(
      { error: "Failed to store caption", details: captionErr?.message },
      { status: 500 },
    );
  }

  // ---- personas lookup ----
  const { data: personas, error: personasErr } = await svc
    .from("personas")
    .select("id, slug");
  if (personasErr || !personas) {
    return NextResponse.json({ error: "Personas fetch failed" }, { status: 500 });
  }
  const bySlug = new Map(personas.map((p) => [p.slug, p.id]));

  // ---- items: upload to Storage + insert rows ----
  const inserted: { id: string; persona: string; path: string }[] = [];
  for (const item of parsed.items) {
    const personaId = bySlug.get(item.persona);
    if (!personaId) continue;

    let buffer: Buffer;
    let mime: string;
    if (item.image_base64) {
      const { data, mime: prefixMime } = stripBase64Prefix(item.image_base64);
      buffer = Buffer.from(data, "base64");
      mime = item.image_mime ?? prefixMime ?? "image/png";
    } else {
      const fetched = await fetchImage(item.image_url!);
      buffer = fetched.buffer;
      mime = item.image_mime ?? fetched.mime;
    }

    const ext = extFromMime(mime);
    const path = `${item.persona}/${run.id}-${crypto.randomUUID()}.${ext}`;

    const { error: uploadErr } = await svc.storage
      .from(PERSONA_BUCKET)
      .upload(path, buffer, { contentType: mime, upsert: false });
    if (uploadErr) {
      return NextResponse.json(
        { error: `Upload failed for ${item.persona}`, details: uploadErr.message },
        { status: 500 },
      );
    }

    const { data: row, error: insertErr } = await svc
      .from("content_items")
      .insert({
        run_id: run.id,
        persona_id: personaId,
        image_path: path,
        caption_id: caption.id,
      })
      .select("id")
      .single();
    if (insertErr || !row) {
      return NextResponse.json(
        { error: "Failed to insert content_item", details: insertErr?.message },
        { status: 500 },
      );
    }

    inserted.push({ id: row.id, persona: item.persona, path });
  }

  return NextResponse.json({
    ok: true,
    run_id: run.id,
    caption_id: caption.id,
    items: inserted,
  });
}
