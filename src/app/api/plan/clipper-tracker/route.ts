/**
 * /api/plan/clipper-tracker — the clipper campaign tracker
 * (src/lib/revenue-plan/clipper-tracker.ts).
 *   GET                 weekly rows, baseline, stop-rule call, per-creator codes
 *   POST {weekStart, viewsBought, payoutsUsd, feesUsd, tranche, note}
 *                       upsert one week's hand-entered spend
 *   DELETE ?week=YYYY-MM-DD   remove that week's entry
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { deleteEntry, loadClipperTracker, saveEntry, validateEntry } from "@/lib/revenue-plan/clipper-tracker-data";
import { MissingTableError, consumerConfigured, internalConfigured } from "@/lib/revenue-plan/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const err = (e: unknown, status = 500) =>
  NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status });

function guard(req: Request): NextResponse | null {
  if (!checkIngestAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!internalConfigured() || !consumerConfigured()) return err("Supabase env missing (internal service role or CONSUMER_*)");
  return null;
}

export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    return NextResponse.json({ ok: true, ...(await loadClipperTracker()) });
  } catch (e) {
    return err(e);
  }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  let entry;
  try {
    entry = validateEntry(await req.json());
  } catch (e) {
    return err(e, 400);
  }
  try {
    await saveEntry(entry);
    return NextResponse.json({ ok: true, entry });
  } catch (e) {
    return err(e instanceof MissingTableError ? new Error("clipper_campaign_weeks does not exist yet: migration 0095 is not applied") : e);
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const week = new URL(req.url).searchParams.get("week") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return err("week must be YYYY-MM-DD", 400);
  try {
    await deleteEntry(week);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return err(e);
  }
}
