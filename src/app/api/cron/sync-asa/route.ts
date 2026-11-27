/**
 * Daily Apple Ads sync (src/lib/asa/sync.ts) into the asa_* tables.
 * Vercel cron, 11:00 UTC (6 AM ET), after Apple has closed the org's day.
 * Reads Apple Ads only; it never changes a campaign.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { asaConfigured } from "@/lib/asa/client";
import { syncAsa } from "@/lib/asa/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!asaConfigured()) return NextResponse.json({ ok: false, error: "ASA_* env vars not set" }, { status: 500 });
  try {
    const result = await syncAsa();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
