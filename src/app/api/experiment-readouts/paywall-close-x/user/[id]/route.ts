/**
 * GET /api/experiment-readouts/paywall-close-x/user/<app_user_id> — one
 * user's Paywall X test arm for the per-user chip, or `arm: null` when they
 * aren't in the test. Admin only (the Support Inbox is admin only).
 */
import { NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/auth-ingest";
import { lookupPaywallXArm } from "@/lib/paywall-x/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdminAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    return NextResponse.json({ ok: true, arm: await lookupPaywallXArm(id) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
