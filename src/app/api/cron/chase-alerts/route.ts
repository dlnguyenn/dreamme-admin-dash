/**
 * Daily Chase alert ingest (src/lib/finance/chase-alerts-store.ts). Vercel
 * cron, 12:00 UTC. Reads the last 7 days of chase.com mail in dan@dreamme.life,
 * so a few missed runs lose nothing. `?days=N` (max 90) backfills further.
 *
 * Zero Chase emails is a normal result until the Gmail forward from
 * dlnguyenn@gmail.com is set up; it still logs a run, so the Spend tab can
 * tell "nothing forwarded yet" from "the cron stopped".
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { chaseAlertsDbConfigured, syncChaseAlerts } from "@/lib/finance/chase-alerts-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!chaseAlertsDbConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  }
  const days = Number(new URL(req.url).searchParams.get("days")) || undefined;
  const result = await syncChaseAlerts({ days, trigger: "cron" });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
