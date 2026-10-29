/**
 * POST   /api/support/threads/[id]/offer-code — hand this thread the next
 *        free Yearly Special code (idempotent: a thread that already has one
 *        gets the same code back). Returns { code, created }.
 * DELETE /api/support/threads/[id]/offer-code — put the thread's code back
 *        in the pool (for a code claimed by mistake and never sent).
 *
 * Claiming marks the code used immediately rather than on send: a code that
 * has been shown on screen can be copied and sent from Gmail, and handing it
 * to a second person would break the first person's redemption.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  claimOfferCode,
  getThread,
  getThreadOfferCode,
  logAction,
  setOfferCodeUsed,
  supportDbConfigured,
} from "@/lib/support/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkIngestAuth(req)) return fail("unauthorized", 401);
  if (!supportDbConfigured()) return fail("Supabase not configured", 500);
  const { id } = await params;
  try {
    const thread = await getThread(id);
    if (!thread) return fail("not found", 404);
    const before = await getThreadOfferCode(id);
    const code = await claimOfferCode({
      threadId: id,
      email: thread.counterpart_email,
      name: thread.counterpart_name,
    });
    if (!code) {
      return fail("No Yearly Special codes left. Import a new batch from App Store Connect.", 409);
    }
    const created = !before || before.code !== code.code;
    if (created) {
      await logAction({
        thread_id: id,
        app_user_id: thread.resolved_app_user_id,
        store: "APP_STORE",
        action_type: "offer_code_claim",
        request: { offer: code.offer_name },
        response: { code: code.code, position: code.position },
        status: "success",
        error: null,
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true, code, created });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkIngestAuth(req)) return fail("unauthorized", 401);
  if (!supportDbConfigured()) return fail("Supabase not configured", 500);
  const { id } = await params;
  try {
    const code = await getThreadOfferCode(id);
    if (!code) return fail("this thread has no code", 404);
    await setOfferCodeUsed(code.code, false);
    const thread = await getThread(id);
    await logAction({
      thread_id: id,
      app_user_id: thread?.resolved_app_user_id ?? null,
      store: "APP_STORE",
      action_type: "offer_code_release",
      request: null,
      response: { code: code.code },
      status: "success",
      error: null,
    }).catch(() => {});
    return NextResponse.json({ ok: true, released: code.code });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
}
