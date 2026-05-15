import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { fetchExecutionCount, n8nConfigured } from "@/lib/vendors/n8n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";
const DEFAULT_WORKFLOW_ID = "wEZAcV8qNd0OTUBQ";

function utcMidnight(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!n8nConfigured()) {
    return NextResponse.json(
      { ok: false, error: "N8N_API_KEY not set" },
      { status: 500 },
    );
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured" },
      { status: 500 },
    );
  }

  const workflowId =
    process.env.N8N_TRIAL_QUALIFIED_WORKFLOW_ID ?? DEFAULT_WORKFLOW_ID;
  const source = `n8n_workflow_${workflowId}`;

  const today = utcMidnight(new Date());
  const dayMs = 24 * 60 * 60 * 1000;

  const rows: Array<{
    date: string;
    count: number;
    source: string;
    synced_at: string;
  }> = [];

  const now = new Date().toISOString();
  try {
    for (let i = 2; i >= 0; i--) {
      const dayStart = new Date(today.getTime() - i * dayMs);
      const dayEnd = new Date(dayStart.getTime() + dayMs);
      const count = await fetchExecutionCount({
        workflowId,
        since: dayStart,
        until: dayEnd,
        status: "success",
      });
      rows.push({
        date: utcDate(dayStart),
        count,
        source,
        synced_at: now,
      });
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 502 },
    );
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
