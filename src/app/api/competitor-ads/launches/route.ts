/**
 * GET /api/competitor-ads/launches?days=60 — every ad the tracked brands
 * launched in the window, stopped ones included, for the Competitor ads tab's
 * Creative tests view (src/lib/competitor-ads-tab/read.ts readLaunches).
 * Read-only; admin only.
 */
import { NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/auth-ingest";
import { supportDbConfigured } from "@/lib/support/db";
import { readLaunches } from "@/lib/competitor-ads-tab/read";
import { LAUNCH_WINDOW_DAYS } from "@/lib/competitor-ads-tab/launches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!checkAdminAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supportDbConfigured()) return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  const asked = Number(new URL(req.url).searchParams.get("days"));
  const days = Number.isFinite(asked) && asked > 0 ? Math.min(90, Math.max(7, Math.round(asked))) : LAUNCH_WINDOW_DAYS;
  try {
    return NextResponse.json(await readLaunches(days));
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
