/**
 * /api/plan/sources — the user_sources copy (src/lib/revenue-plan/user-sources.ts).
 *   GET          which table the panels read sources from, row count, last sync
 *   POST ?full=1 run the sync now (full = every consumer user, the backfill);
 *                the April Plan tab's Backfill button calls this.
 * The nightly run is /api/cron/sync-user-sources.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { MissingTableError, consumerConfigured, internalConfigured } from "@/lib/revenue-plan/db";
import { clearSourceStatusCache, sourceStatus, syncUserSources } from "@/lib/revenue-plan/user-sources";
import { invalidate } from "@/lib/dad-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const err = (e: unknown, status = 500) =>
  NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) return err("unauthorized", 401);
  if (!internalConfigured()) return err("Internal Supabase env missing");
  try {
    clearSourceStatusCache();
    return NextResponse.json({ ok: true, ...(await sourceStatus()) });
  } catch (e) {
    return err(e);
  }
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) return err("unauthorized", 401);
  if (!internalConfigured() || !consumerConfigured()) return err("Supabase env missing (internal service role or CONSUMER_*)");
  const full = new URL(req.url).searchParams.get("full") === "1";
  try {
    const result = await syncUserSources({ full });
    clearSourceStatusCache();
    await invalidate("plan-");
    return NextResponse.json({ ok: true, ...result, status: await sourceStatus() });
  } catch (e) {
    return err(e instanceof MissingTableError ? new Error("user_sources does not exist yet: migration 0095 is not applied") : e);
  }
}
