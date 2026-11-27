/**
 * Apple Ads tab (src/components/asa/AppleAds.tsx).
 *
 * GET  — the tab payload, read from the asa_* tables (src/lib/asa/read.ts).
 * POST — sync from Apple Ads now (same as the daily cron). Optional
 *        { days } up to 90 for a backfill. Read-only toward Apple.
 * Admin only: it shows ad spend.
 */
import { NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/auth-ingest";
import { supportDbConfigured } from "@/lib/support/db";
import { asaConfigured } from "@/lib/asa/client";
import { buildAsaPayload } from "@/lib/asa/read";
import { syncAsa } from "@/lib/asa/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const fail = (e: unknown) =>
  NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });

function guard(req: Request): NextResponse | null {
  if (!checkAdminAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supportDbConfigured()) return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  return null;
}

export async function GET(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  try {
    return NextResponse.json(await buildAsaPayload());
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  if (!asaConfigured()) {
    return NextResponse.json({ ok: false, error: "Apple Ads keys aren't set on the server (ASA_* env vars)" }, { status: 400 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { days?: number };
    const result = await syncAsa({ days: body.days });
    return NextResponse.json({ ...result }, { status: result.ok ? 200 : 207 });
  } catch (e) {
    return fail(e);
  }
}
