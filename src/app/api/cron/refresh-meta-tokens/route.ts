/**
 * Re-extend long-lived Meta tokens before they expire (~60d). Long-lived FB
 * tokens can be re-exchanged while still valid to reset the clock; this cron
 * does that for any connection within ~7 days of expiry. Cron-auth gated.
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
  const withinDays = Number(url.searchParams.get("within_days") ?? "7") || 7;
  const result = await refreshExpiring(withinDays);
  return NextResponse.json({ ok: true, ...result });
}
