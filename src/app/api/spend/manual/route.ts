import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";

const VENDORS = [
  "anthropic",
  "google",
  "apify",
  "vercel",
  "supabase",
  "business_cc",
  "other",
] as const;

const Body = z.object({
  vendor: z.enum(VENDORS),
  category: z.enum(["ai", "business"]),
  amount_usd: z.number().finite().nonnegative(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(500).optional(),
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
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const row = {
    ...parsed.data,
    source: "manual",
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/spend_line_items`, {
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
  return NextResponse.json({ ok: true, row: Array.isArray(data) ? data[0] : data });
}

export async function DELETE(req: Request) {
  if (!checkIngestAuth(req)) return unauthorized();
  if (!SUPABASE_URL || !SERVICE_ROLE) return misconfigured();

  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "missing id" },
      { status: 400 },
    );
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/spend_line_items?id=eq.${encodeURIComponent(id)}`,
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
