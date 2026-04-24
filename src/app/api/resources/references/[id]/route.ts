import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { extractStoragePath, storageDelete } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

function sbHeaders() {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

const SlideSchema = z.object({
  image_url: z.string().url(),
  note: z.string().max(2000),
});

const Patch = z
  .object({
    title: z.string().min(1).max(200).optional(),
    slides: z.array(SlideSchema).max(60).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty patch" });

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    { status: 401 },
  );
}

function misconfigured() {
  return NextResponse.json(
    { ok: false, error: "Supabase service role not configured" },
    { status: 500 },
  );
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkIngestAuth(req)) return unauthorized();
  if (!SUPABASE_URL || !SERVICE_ROLE) return misconfigured();

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing id" },
      { status: 400 },
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
  const parsed = Patch.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.slides !== undefined) patch.slides = parsed.data.slides;

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/resource_references?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { ...sbHeaders(), Prefer: "return=representation" },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `reference update failed: ${res.status} ${await res.text()}`,
      },
      { status: 500 },
    );
  }
  const data = await res.json();
  const reference = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ ok: true, reference });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkIngestAuth(req)) return unauthorized();
  if (!SUPABASE_URL || !SERVICE_ROLE) return misconfigured();

  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing id" },
      { status: 400 },
    );
  }

  // Best-effort: look up the row's slides and try to clean up storage blobs
  // before deleting the row. A failure here doesn't block the DB delete —
  // orphan blobs can be cleaned later.
  try {
    const lookup = await fetch(
      `${SUPABASE_URL}/rest/v1/resource_references?select=slides&id=eq.${encodeURIComponent(id)}&limit=1`,
      { headers: sbHeaders(), cache: "no-store" },
    );
    if (lookup.ok) {
      const rows = (await lookup.json()) as Array<{
        slides: Array<{ image_url: string; note: string }> | null;
      }>;
      const slides = rows[0]?.slides ?? [];
      for (const s of slides) {
        const path = extractStoragePath(s.image_url);
        if (path) await storageDelete(path);
      }
    }
  } catch {
    // Swallow — DB delete below is the source of truth for the UI.
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/resource_references?id=eq.${encodeURIComponent(id)}`,
    { method: "DELETE", headers: sbHeaders() },
  );
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `reference delete failed: ${res.status} ${await res.text()}`,
      },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
