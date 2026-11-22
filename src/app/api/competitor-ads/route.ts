/**
 * GET /api/competitor-ads — the Competitor ads tab payload
 * (src/lib/competitor-ads-tab/read.ts). Read-only; admin only.
 */
import { NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/auth-ingest";
import { supportDbConfigured } from "@/lib/support/db";
import { buildCompetitorAdsPayload } from "@/lib/competitor-ads-tab/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!checkAdminAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supportDbConfigured()) return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  try {
    return NextResponse.json(await buildCompetitorAdsPayload());
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
