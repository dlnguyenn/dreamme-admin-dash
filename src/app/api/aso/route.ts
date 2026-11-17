/**
 * App Store listing (ASO) tab (src/components/aso/AsoTab.tsx).
 *
 * GET  — the tab payload from Supabase (src/lib/aso/read.ts).
 * POST — { what: "store", instances? } pulls App Store Connect analytics now;
 *        { what: "ranks" } runs one rank-check pass. Same as the crons.
 * Admin only.
 */
import { NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/auth-ingest";
import { supportDbConfigured } from "@/lib/support/db";
import { ascAnalyticsConfigured, syncAsoStore } from "@/lib/aso/asc-analytics";
import { buildAsoPayload } from "@/lib/aso/read";
import { runRankChecks } from "@/lib/aso/ranks";

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
    return NextResponse.json(await buildAsoPayload());
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  try {
    const body = (await req.json().catch(() => ({}))) as { what?: string; instances?: number };
    if (body.what === "ranks") return NextResponse.json(await runRankChecks());
    if (!ascAnalyticsConfigured()) {
      return NextResponse.json({ ok: false, error: "App Store Connect keys aren't set (ASC_* env vars)" }, { status: 400 });
    }
    const result = await syncAsoStore({ maxInstances: body.instances });
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (e) {
    return fail(e);
  }
}
