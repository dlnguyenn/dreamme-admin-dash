import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

// Counts come from the dash's own CAPI sender (capi_trial_qualified_log,
// migration 0081), which replaced the n8n workflow that died 2026-07-06.
// Only days the log covers are upserted, so older n8n-sourced rows stay.
const SOURCE = "capi_trial_qualified_log";

function utcMidnight(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function sbGet<T>(path: string): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T[];
}

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
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

  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days") ?? "35");
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 90) : 35;

  const today = utcMidnight(new Date());
  const dayMs = 24 * 60 * 60 * 1000;
  const windowStart = new Date(today.getTime() - (days - 1) * dayMs);

  let logged: Array<{ trial_started_at: string; status: string }>;
  try {
    logged = await sbGet(
      `capi_trial_qualified_log?select=trial_started_at,status` +
        `&trial_started_at=gte.${windowStart.toISOString()}&order=trial_started_at.asc&limit=20000`,
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 502 },
    );
  }
  if (!logged.length) {
    return NextResponse.json({ ok: true, upserted: 0, rows: [] });
  }

  // Qualified trials per trial-start day, from the first logged day on.
  const counts = new Map<string, number>();
  for (const r of logged) {
    const day = utcDate(new Date(r.trial_started_at));
    counts.set(day, (counts.get(day) ?? 0) + (r.status === "sent" ? 1 : 0));
  }
  const firstDay = utcMidnight(new Date(logged[0].trial_started_at));

  const now = new Date().toISOString();
  const rows: Array<{
    date: string;
    count: number;
    source: string;
    synced_at: string;
  }> = [];
  for (let d = firstDay.getTime(); d <= today.getTime(); d += dayMs) {
    const date = utcDate(new Date(d));
    rows.push({ date, count: counts.get(date) ?? 0, source: SOURCE, synced_at: now });
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/qualified_trials_daily?on_conflict=date`,
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
      {
        ok: false,
        error: `upsert failed: ${res.status} ${await res.text()}`,
      },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, upserted: rows.length, rows });
}
