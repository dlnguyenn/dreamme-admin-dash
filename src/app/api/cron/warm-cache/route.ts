/**
 * GET /api/cron/warm-cache — recompute every precomputed DAD payload
 * (src/lib/dad-cache-jobs.ts) so the slow tabs always open from a fresh copy.
 * Fired every 10 minutes by pg_cron (dad_warm_cache_tick, migration 0106),
 * which reuses the Support Inbox poll's Vault secrets. CRON_SECRET only.
 * Jobs run one after another; one failing doesn't stop the rest, and the
 * response lists each one.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { warm } from "@/lib/dad-cache";
import { cacheJobs } from "@/lib/dad-cache-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // One at a time on purpose. Run together (first version, 2026-11-09), the
  // jobs' rc_events reads piled up: each took ~23 s instead of 2-7 s and three
  // hit PostgREST's 8 s statement timeout. In sequence the whole set is ~30 s.
  const results: ({ key: string; ok: true; ms: number } | { key: string; ok: false; error: string })[] = [];
  for (const [key, job] of Object.entries(cacheJobs())) {
    try {
      results.push({ key, ok: true, ms: await warm(key, job.run) });
    } catch (e) {
      results.push({ key, ok: false, error: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    }
  }
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}
