import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const Patch = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    status: z
      .enum(["new", "planned", "in_progress", "shipped", "declined"])
      .optional(),
    epic: z.string().max(100).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "empty patch",
  });

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

  const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  if (patch.epic === "") patch.epic = null;

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/feature_requests?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `update failed: ${res.status} ${await res.text()}` },
      { status: 500 },
    );
  }
  const data = await res.json();
  return NextResponse.json({
    ok: true,
    row: Array.isArray(data) ? data[0] : data,
  });
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

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/feature_requests?id=eq.${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
    },
  );
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `delete failed: ${res.status} ${await res.text()}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
