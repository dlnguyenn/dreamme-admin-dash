import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import {
  apifyUsageConfigured,
  fetchApifyCurrentCycle,
} from "@/lib/vendors/apify-usage";

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
  if (!apifyUsageConfigured()) {
    return NextResponse.json(
      { ok: false, error: "APIFY_KEY not set" },
      { status: 500 },
    );
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured" },
      { status: 500 },
    );
  }

  let cycle: Awaited<ReturnType<typeof fetchApifyCurrentCycle>>;
  try {
    cycle = await fetchApifyCurrentCycle();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 502 },
    );
  }

  const rows = cycle.dailyBreakdown.map((d) => ({
    vendor: "apify",
    category: "ai",
    amount_usd: d.usd,
    period_start: d.date,
    period_end: d.date,
    source: "api",
    metadata: { cycle_start: cycle.cycleStart, cycle_end: cycle.cycleEnd },
  }));

  if (!rows.length) {
    return NextResponse.json({
      ok: true,
      upserted: 0,
      note: "no daily breakdown returned by Apify",
    });
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
  return NextResponse.json({
    ok: true,
    upserted: rows.length,
    cycleStart: cycle.cycleStart,
    cycleEnd: cycle.cycleEnd,
    usdTotal: cycle.usdTotal,
  });
}
