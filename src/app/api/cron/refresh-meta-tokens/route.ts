/**
 * Re-extend long-lived Meta tokens before they expire (~60d). Long-lived FB
 * tokens can be re-exchanged while still valid to reset the clock — but ONLY
 * while young: at end-of-life the exchange returns the residual lifetime
 * (observed 2026-08-28, token died same day despite refreshed:1). So the
 * weekly cron re-exchanges every active token (within_days=60 covers all),
 * keeping expiry ~60d out instead of racing it. Cron-auth gated.
 */
import { NextResponse, type NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { refreshExpiring } from "@/lib/meta-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const withinDays = Number(url.searchParams.get("within_days") ?? "60") || 60;
  const result = await refreshExpiring(withinDays);
  return NextResponse.json({ ok: true, ...result });
}
