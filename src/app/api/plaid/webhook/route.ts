import { NextResponse } from "next/server";
import { syncAllPlaidItems } from "@/lib/spend/plaid-sync";
import { plaidConfigured } from "@/lib/vendors/plaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Plaid notifies us here whenever transactions for a linked item are
 * available or have changed. We trust Plaid (no shared secret on the
 * default webhook URL — verification requires JWT, which we can add
 * later if abuse becomes a concern). For now, treat every notification
 * as a hint to re-sync.
 *
 * Webhooks of interest:
 *   SYNC_UPDATES_AVAILABLE  — new added/modified/removed since cursor
 *   INITIAL_UPDATE          — first batch ready after Link
 *   HISTORICAL_UPDATE       — older transactions backfilled
 *   DEFAULT_UPDATE          — additional new transactions
 */
export async function POST(req: Request) {
  if (!plaidConfigured()) {
    // 200 so Plaid doesn't keep retrying us when keys are missing.
    return NextResponse.json({ ok: true, skipped: "not configured" });
  }
  let body: { webhook_type?: string; webhook_code?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: true, skipped: "no body" });
  }
  const code = body.webhook_code ?? "";
  const ofInterest = [
    "SYNC_UPDATES_AVAILABLE",
    "INITIAL_UPDATE",
    "HISTORICAL_UPDATE",
    "DEFAULT_UPDATE",
    "TRANSACTIONS_REMOVED",
  ];
  if (!ofInterest.includes(code)) {
    return NextResponse.json({ ok: true, skipped: code || "unknown" });
  }

  try {
    const result = await syncAllPlaidItems();
    return NextResponse.json({ ok: true, code, ...result });
  } catch (err) {
    // Always return 200 to Plaid (otherwise they retry aggressively).
    // Log the error in the response body for our own debugging.
    return NextResponse.json({
      ok: false,
      code,
      error: (err as Error).message,
    });
  }
}
