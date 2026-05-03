import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

interface UsageEventRow {
  computed_usd: string | number;
  created_at: string;
}

/**
 * Aggregates ai_usage_events (vendor='google') into daily totals and
 * upserts into spend_line_items. Idempotent — re-running on the same
 * window overwrites the existing 'api'-source row for each day.
 *
 * Lookback is 40 days, matching the Anthropic sync. Older rows are
 * frozen once they roll out of the window.
 */
export async function GET(req: Request) {
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

  const end = new Date();
  const start = new Date(end.getTime() - 40 * 24 * 60 * 60 * 1000);
  const startIso = start.toISOString();

  const eventsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_usage_events?select=computed_usd,created_at&vendor=eq.google&created_at=gte.${encodeURIComponent(startIso)}`,
    {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      cache: "no-store",
    },
  );
  if (!eventsRes.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `events fetch failed: ${eventsRes.status} ${await eventsRes.text()}`,
      },
      { status: 502 },
    );
  }
  const events = (await eventsRes.json()) as UsageEventRow[];

  // Bucket by UTC day so dashboards line up with Anthropic/Apify, which
  // also key off date-only fields.
  const byDay = new Map<string, number>();
  for (const e of events) {
    const day = e.created_at.slice(0, 10);
    const usd = Number(e.computed_usd) || 0;
    byDay.set(day, (byDay.get(day) ?? 0) + usd);
  }

  const rows = Array.from(byDay.entries())
    .map(([day, usd]) => ({
      vendor: "google",
      category: "ai",
      amount_usd: Math.round(usd * 100) / 100,
      period_start: day,
      period_end: day,
      source: "api",
    }))
    // Drop sub-cent days — they're noise, and the dashboard rounds to
    // whole dollars anyway.
    .filter((r) => r.amount_usd > 0);

  if (!rows.length) {
    return NextResponse.json({
      ok: true,
      upserted: 0,
      eventCount: events.length,
      note: "no priced Gemini usage in window",
    });
  }

  const upsertRes = await fetch(
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
  if (!upsertRes.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `upsert failed: ${upsertRes.status} ${await upsertRes.text()}`,
      },
      { status: 500 },
    );
  }

  const totalUsd = rows.reduce((s, r) => s + r.amount_usd, 0);
  return NextResponse.json({
    ok: true,
    upserted: rows.length,
    eventCount: events.length,
    totalUsd: Math.round(totalUsd * 100) / 100,
  });
}
