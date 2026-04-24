import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";
const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? "dreamme-admin-internal-images";

const Patch = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    linkUrl: z.string().url().max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty patch" });

function sbHeaders() {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
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

  // Map camelCase patch to snake_case DB columns. The DB trigger bumps
  // updated_at on its own.
  const dbPatch: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) dbPatch.title = parsed.data.title;
  if (parsed.data.description !== undefined)
    dbPatch.description = parsed.data.description;
  if (parsed.data.tags !== undefined) dbPatch.tags = parsed.data.tags;
  if (parsed.data.linkUrl !== undefined) dbPatch.link_url = parsed.data.linkUrl;

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/resources?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { ...sbHeaders(), Prefer: "return=representation" },
      body: JSON.stringify(dbPatch),
    },
  );
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `resource update failed: ${res.status} ${await res.text()}`,
      },
      { status: 500 },
    );
  }
  const data = await res.json();
  const resource = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ ok: true, resource });
}

async function storageDelete(path: string): Promise<boolean> {
  // Non-fatal: if the storage delete fails we still remove the DB row so
  // the UI reflects the user's intent. Orphan blobs can be cleaned later.
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
    return res.ok;
  } catch {
    return false;
  }
}

function extractStoragePath(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  // Public URL shape: ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const i = imageUrl.indexOf(marker);
  if (i < 0) return null;
  return imageUrl.slice(i + marker.length);
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

  // Best-effort cleanup: look up the row first so we can remove the
  // storage blob too (image-kind only).
  try {
    const lookup = await fetch(
      `${SUPABASE_URL}/rest/v1/resources?select=kind,image_url&id=eq.${encodeURIComponent(id)}&limit=1`,
      { headers: sbHeaders(), cache: "no-store" },
    );
    if (lookup.ok) {
      const rows = (await lookup.json()) as Array<{
        kind: string;
        image_url: string | null;
      }>;
      const row = rows[0];
      if (row && row.kind === "image") {
        const path = extractStoragePath(row.image_url);
        if (path) await storageDelete(path);
      }
    }
  } catch {
    // Swallow — DB delete below is the source of truth for the UI.
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/resources?id=eq.${encodeURIComponent(id)}`,
    { method: "DELETE", headers: sbHeaders() },
  );
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `resource delete failed: ${res.status} ${await res.text()}`,
      },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
