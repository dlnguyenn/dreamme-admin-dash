/**
 * POST /api/support/threads/[id]/link
 *
 * Attach a Stripe customer to a thread whose sender address matched no
 * account, so the sidebar fills in and the cancel/refund buttons work.
 * Body: { customerId } to link, { unlink: true } to detach.
 *
 * Guardrail: never overwrite a genuinely resolved account. Linking is
 * only allowed when the thread has no matched app user, and the written
 * context keeps noAccount:true plus linkedStripeCustomerId so the UI can
 * show it as manually attached. Both directions are audit-logged.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  getThread,
  logAction,
  patchThread,
  supportDbConfigured,
} from "@/lib/support/db";
import { contextFromStripeCustomers } from "@/lib/support/resolve-user";
import { stripeConfigured } from "@/lib/vendors/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z
  .object({
    customerId: z.string().min(3).max(120).optional(),
    name: z.string().max(200).nullable().optional(),
    unlink: z.boolean().optional(),
  })
  .refine((v) => !!v.customerId || v.unlink === true, {
    message: "customerId or unlink required",
  });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!supportDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }

  const { id } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const thread = await getThread(id);
    if (!thread) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    // ---- unlink -----------------------------------------------------
    if (parsed.data.unlink) {
      const linked = thread.user_context?.linkedStripeCustomerId ?? null;
      await patchThread(id, { user_context: null, resolved_store: null });
      await logAction({
        thread_id: id,
        app_user_id: thread.resolved_app_user_id,
        store: "STRIPE",
        action_type: "unlink_stripe_customer",
        request: { customerId: linked },
        response: null,
        status: "success",
        error: null,
      }).catch(() => {});
      const fresh = await getThread(id);
      return NextResponse.json({ ok: true, thread: fresh });
    }

    // ---- link -------------------------------------------------------
    if (!stripeConfigured()) {
      return NextResponse.json(
        { ok: false, error: "STRIPE_SECRET_KEY not set" },
        { status: 503 },
      );
    }
    // Only fill a gap, never replace a real match.
    const ctx = thread.user_context;
    if (ctx && !ctx.noAccount && ctx.appUserId) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "this thread already resolves to a DreamMe account — refusing to overwrite it",
        },
        { status: 409 },
      );
    }

    const customerId = parsed.data.customerId!;
    const linkedCtx = await contextFromStripeCustomers([customerId], null, {
      name: parsed.data.name ?? null,
      linkedCustomerId: customerId,
    });
    if (!linkedCtx) {
      return NextResponse.json(
        {
          ok: false,
          error: "that Stripe customer has no subscription to attach",
        },
        { status: 404 },
      );
    }
    // Keep the address they actually wrote from for replies.
    linkedCtx.email = thread.counterpart_email ?? linkedCtx.email;

    await patchThread(id, {
      user_context: linkedCtx,
      resolved_store: "STRIPE",
    });
    await logAction({
      thread_id: id,
      app_user_id: thread.resolved_app_user_id,
      store: "STRIPE",
      action_type: "link_stripe_customer",
      request: { customerId, name: parsed.data.name ?? null },
      response: {
        subscriptions: linkedCtx.subscriptions.length,
        totalSpentUsd: linkedCtx.totalSpentUsd,
      },
      status: "success",
      error: null,
    }).catch(() => {});

    const fresh = await getThread(id);
    return NextResponse.json({ ok: true, thread: fresh });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
