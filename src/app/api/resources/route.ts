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

function sbHeaders() {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

function serverConfigured() {
  return !!SUPABASE_URL && !!SERVICE_ROLE;
}

const CreateBody = z.object({
  kind: z.enum(["link"]), // image creation goes through /upload
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  linkUrl: z.string().url().max(2000),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!serverConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured on server" },
      { status: 500 },
    );
  }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/resources?select=*&order=sort_order.desc,created_at.desc`,
      { headers: sbHeaders(), cache: "no-store" },
    );
    if (!res.ok) {
      throw new Error(
        `resources read failed: ${res.status} ${await res.text()}`,
      );
    }
    const resources = await res.json();
    return NextResponse.json({ ok: true, resources });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!serverConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured on server" },
      { status: 500 },
    );
  }
  let parsed: z.infer<typeof CreateBody>;
  try {
    parsed = CreateBody.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 400 },
    );
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/resources`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "return=representation" },
      body: JSON.stringify({
        kind: parsed.kind,
        title: parsed.title,
        description: parsed.description ?? null,
        link_url: parsed.linkUrl,
        tags: parsed.tags ?? [],
      }),
    });
    if (!res.ok) {
      throw new Error(
        `resources insert failed: ${res.status} ${await res.text()}`,
      );
    }
    const rows = await res.json();
    const resource = Array.isArray(rows) ? rows[0] : rows;
    return NextResponse.json({ ok: true, resource });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
