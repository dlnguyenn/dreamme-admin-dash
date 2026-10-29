/**
 * POST   /api/support/threads/[id]/offer-code?offer=<name> — hand this
 *        thread the next free code of that offer ("Yearly Special" by
 *        default, or "Pearl Pack"). Idempotent: a thread that already has
 *        one gets the same code back. Returns { code, created }.
 * DELETE /api/support/threads/[id]/offer-code?offer=<name> — put the
 *        thread's code back in the pool (for one claimed by mistake and
 *        never sent).
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
import { isOfferName, YEARLY_SPECIAL, type OfferName } from "@/lib/support/offer-codes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

function offerFrom(req: Request): OfferName | null {
  const raw = new URL(req.url).searchParams.get("offer") ?? YEARLY_SPECIAL;
  return isOfferName(raw) ? raw : null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkIngestAuth(req)) return fail("unauthorized", 401);
  if (!supportDbConfigured()) return fail("Supabase not configured", 500);
  const offer = offerFrom(req);
  if (!offer) return fail("unknown offer", 400);
  const { id } = await params;
  try {
    const thread = await getThread(id);
    if (!thread) return fail("not found", 404);
    const before = await getThreadOfferCode(id, offer);
    const code = await claimOfferCode({
      threadId: id,
      offerName: offer,
      email: thread.counterpart_email,
      name: thread.counterpart_name,
    });
    if (!code) {
      return fail(`No ${offer} codes left. Import a new batch from App Store Connect.`, 409);
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
  const offer = offerFrom(req);
  if (!offer) return fail("unknown offer", 400);
  const { id } = await params;
  try {
    const code = await getThreadOfferCode(id, offer);
    if (!code) return fail(`this thread has no ${offer} code`, 404);
    await setOfferCodeUsed(code.code, false);
    const thread = await getThread(id);
    await logAction({
      thread_id: id,
      app_user_id: thread?.resolved_app_user_id ?? null,
      store: "APP_STORE",
      action_type: "offer_code_release",
      request: { offer },
      response: { code: code.code },
      status: "success",
      error: null,
    }).catch(() => {});
    return NextResponse.json({ ok: true, released: code.code });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
}
