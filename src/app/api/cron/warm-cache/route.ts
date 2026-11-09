/**
 * GET /api/cron/warm-cache — recompute every precomputed DAD payload
 * (src/lib/dad-cache-jobs.ts) so the slow tabs always open from a fresh copy.
 * Fired every 10 minutes by pg_cron (dad_warm_cache_tick, migration 0106),
 * which reuses the Support Inbox poll's Vault secrets. CRON_SECRET only.
 * One job failing doesn't stop the others; the response lists each one.
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
  const jobs = cacheJobs();
  const results = await Promise.all(
    Object.entries(jobs).map(async ([key, job]) => {
      try {
        return { key, ok: true, ms: await warm(key, job.run) };
      } catch (e) {
        return { key, ok: false, error: e instanceof Error ? e.message.slice(0, 200) : String(e) };
      }
    }),
  );
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}
