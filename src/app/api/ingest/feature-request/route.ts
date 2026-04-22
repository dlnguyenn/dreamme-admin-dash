import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const Body = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  epic: z.string().max(100).optional(),
  submitter_email: z.string().email().max(200).optional(),
});

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured" },
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

  const row = {
    title: parsed.data.title.trim(),
    description: parsed.data.description?.trim() ?? "",
    epic: parsed.data.epic?.trim() || null,
    submitter_email: parsed.data.submitter_email?.trim() || null,
    status: "new",
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/feature_requests`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `insert failed: ${res.status} ${await res.text()}` },
      { status: 500 },
    );
  }
  const data = await res.json();
  const saved = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ ok: true, id: saved?.id, row: saved });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/ingest/feature-request",
    auth: "send X-DreamMe-Secret (or Authorization: Bearer <INGEST_TOKEN>)",
    schema: {
      title: "string (1..200, required)",
      description: "string (0..5000, optional)",
      epic: "string (0..100, optional free-text tag)",
      submitter_email: "string (email, optional)",
    },
  });
}
