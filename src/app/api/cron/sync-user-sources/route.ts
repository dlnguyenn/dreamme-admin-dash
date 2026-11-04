/**
 * Nightly copy of consumer users' onboarding answer into user_sources
 * (src/lib/revenue-plan/user-sources.ts), so rc_events joins on app_user_id.
 *
 * Vercel cron, 06:30 UTC: re-copies users whose updated_at or joined_at moved
 * in the last 3 days. ?full=1 copies every user (the one-time backfill, ~58k
 * rows, about a minute).
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { consumerConfigured, internalConfigured } from "@/lib/revenue-plan/db";
import { syncUserSources } from "@/lib/revenue-plan/user-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!internalConfigured() || !consumerConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase env missing (internal service role or CONSUMER_*)" }, { status: 500 });
  }
  try {
    const full = new URL(req.url).searchParams.get("full") === "1";
    return NextResponse.json({ ok: true, ...(await syncUserSources({ full })) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
