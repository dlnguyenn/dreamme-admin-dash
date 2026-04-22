import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import {
  anthropicAdminConfigured,
  fetchAnthropicDailyCost,
} from "@/lib/vendors/anthropic-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!anthropicAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "ANTHROPIC_ADMIN_KEY not set" },
      { status: 500 },
    );
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured" },
      { status: 500 },
    );
  }

  const end = new Date();
  const start = new Date(end.getTime() - 40 * 24 * 60 * 60 * 1000);

  let daily: Awaited<ReturnType<typeof fetchAnthropicDailyCost>>;
  try {
    daily = await fetchAnthropicDailyCost({ start, end });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 502 },
    );
  }

  const rows = daily.map((d) => ({
    vendor: "anthropic",
    category: "ai",
    amount_usd: d.usd,
    period_start: d.date,
    period_end: d.date,
    source: "api",
  }));

  if (!rows.length) {
    return NextResponse.json({ ok: true, upserted: 0 });
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/spend_line_items?on_conflict=vendor,period_start,period_end,source`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `upsert failed: ${res.status} ${await res.text()}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, upserted: rows.length });
}
