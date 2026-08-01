/**
 * POST /api/support/threads/[id]/action — execute a subscription action for
 * the thread's resolved user. Every mutating call is written to the
 * support_actions audit log whether it succeeds or fails. The route never
 * sends email.
 *
 * Action types:
 *   stripe_lookup                — read-only: resolve subscription + latest
 *                                  charge so the confirm dialog can show the
 *                                  real amount/date before enabling Confirm
 *   stripe_cancel_at_period_end  — { subscriptionId }
 *   stripe_cancel_now            — { subscriptionId }
 *   stripe_refund                — { paymentIntentId, amountCents? }
 *   rc_play_refund_revoke        — { productId } (refunds latest Play charge
 *                                  AND revokes access, via RevenueCat v1)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  getActionsForUserOrThread,
  getThread,
  logAction,
  patchThread,
  supportDbConfigured,
} from "@/lib/support/db";
import {
  applyActionToContext,
  completedActions,
} from "@/lib/support/action-effects";
import {
  cancelSubscription,
  createRefund,
  findCustomersByEmail,
  getLatestCharge,
  getSubscription,
  listSubscriptionsForCustomer,
  resolveSubscriptionFromItem,
  stripeConfigured,
  type StripeSubscription,
} from "@/lib/vendors/stripe";
import {
  refundAndRevokePlaySubscription,
  revenueCatConfigured,
} from "@/lib/vendors/revenuecat-actions";
import type { SupportThreadRow } from "@/lib/support/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  type: z.enum([
    "stripe_lookup",
    "stripe_cancel_at_period_end",
    "stripe_cancel_now",
    "stripe_refund",
    "rc_play_refund_revoke",
  ]),
  /** rc_events transaction id (si_…) to resolve the Stripe subscription */
  transactionId: z.string().max(200).optional(),
  subscriptionId: z.string().max(200).optional(),
  paymentIntentId: z.string().max(200).optional(),
  chargeId: z.string().max(200).optional(),
  amountCents: z.number().int().positive().optional(),
  productId: z.string().max(200).optional(),
});

type ActionBody = z.infer<typeof Body>;

async function resolveStripeSub(
  thread: SupportThreadRow,
  body: ActionBody,
): Promise<StripeSubscription | null> {
  if (body.subscriptionId) {
    return getSubscription(body.subscriptionId);
  }
  if (body.transactionId) {
    const subId = await resolveSubscriptionFromItem(body.transactionId);
    if (subId) return getSubscription(subId);
  }
  // Fallback: customer search by the resolved email.
  const email = thread.user_context?.email ?? thread.counterpart_email;
  if (!email) return null;
  const customers = await findCustomersByEmail(email);
  for (const c of customers) {
    const subs = await listSubscriptionsForCustomer(c.id);
    const active =
      subs.find((s) => s.status === "trialing" || s.status === "active") ??
      subs[0];
    if (active) return active;
  }
  return null;
}

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
  const body = parsed.data;

  const thread = await getThread(id);
  if (!thread) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const isStripe = body.type.startsWith("stripe_");
  if (isStripe && !stripeConfigured()) {
    return NextResponse.json(
      { ok: false, error: "STRIPE_SECRET_KEY not set" },
      { status: 503 },
    );
  }
  if (body.type === "rc_play_refund_revoke" && !revenueCatConfigured()) {
    return NextResponse.json(
      { ok: false, error: "REVENUECAT_API_KEY / REVENUECAT_PROJECT_ID not set" },
      { status: 503 },
    );
  }

  // Guard: the action must match the resolved store (lookup is exempt so the
  // sidebar can probe when resolution was fuzzy).
  const store = thread.resolved_store;
  if (isStripe && body.type !== "stripe_lookup" && store !== "STRIPE") {
    return NextResponse.json(
      { ok: false, error: `thread resolved to ${store ?? "no"} store, not STRIPE` },
      { status: 400 },
    );
  }
  if (body.type === "rc_play_refund_revoke" && store !== "PLAY_STORE") {
    return NextResponse.json(
      { ok: false, error: `thread resolved to ${store ?? "no"} store, not PLAY_STORE` },
      { status: 400 },
    );
  }

  // ---- read-only lookup (not audit-logged) --------------------------------
  if (body.type === "stripe_lookup") {
    try {
      const sub = await resolveStripeSub(thread, body);
      if (!sub) {
        return NextResponse.json(
          { ok: false, error: "No Stripe subscription found for this user" },
          { status: 404 },
        );
      }
      const charge = await getLatestCharge(sub.id);
      return NextResponse.json({ ok: true, subscription: sub, latestCharge: charge });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  }

  // ---- repeat guard -------------------------------------------------------
  // The buttons disable once an action has succeeded, but a stale tab or a
  // direct call must not be able to refund/cancel the same person twice.
  // Scoped to the USER so a second thread from the same emailer is covered.
  try {
    const prior = await getActionsForUserOrThread(
      id,
      thread.resolved_app_user_id,
    );
    const already = completedActions(prior).get(body.type);
    if (already) {
      return NextResponse.json(
        {
          ok: false,
          error: `${body.type} already succeeded for this user on ${new Date(
            already.created_at,
          ).toLocaleString()} — refusing to repeat it. If a genuinely new charge needs refunding, do it in the Stripe dashboard.`,
        },
        { status: 409 },
      );
    }
  } catch {
    // A guard lookup failure must not block support work; the UI lock and
    // the confirm dialog still stand.
  }

  // ---- mutating actions (always audit-logged) -----------------------------
  const audit = {
    thread_id: id,
    app_user_id: thread.resolved_app_user_id,
    store,
    action_type: body.type,
    request: body as Record<string, unknown>,
  };

  try {
    let response: Record<string, unknown>;
    switch (body.type) {
      case "stripe_cancel_at_period_end":
      case "stripe_cancel_now": {
        if (!body.subscriptionId) throw new Error("subscriptionId required");
        const sub = await cancelSubscription(body.subscriptionId, {
          atPeriodEnd: body.type === "stripe_cancel_at_period_end",
        });
        response = {
          subscriptionId: sub.id,
          status: sub.status,
          cancel_at_period_end: sub.cancel_at_period_end,
          current_period_end: sub.current_period_end,
        };
        break;
      }
      case "stripe_refund": {
        if (!body.chargeId && !body.paymentIntentId) {
          throw new Error("chargeId or paymentIntentId required");
        }
        const refund = await createRefund({
          chargeId: body.chargeId,
          paymentIntentId: body.paymentIntentId,
          amount: body.amountCents,
        });
        response = { refundId: refund.id, status: refund.status, amount: refund.amount, currency: refund.currency };
        break;
      }
      case "rc_play_refund_revoke": {
        if (!thread.resolved_app_user_id) throw new Error("no resolved app_user_id");
        const result = await refundAndRevokePlaySubscription(
          thread.resolved_app_user_id,
        );
        response = {
          subscriptionId: result.subscriptionId,
          body: result.response,
        } as Record<string, unknown>;
        break;
      }
      default:
        throw new Error(`unhandled action ${body.type}`);
    }

    const logged = await logAction({
      ...audit,
      response,
      status: "success",
      error: null,
    });

    // Flip the sidebar immediately (Active → closed / won't renew / paid
    // total) — RC's webhook takes minutes to reflect what we just did.
    const updatedCtx = applyActionToContext(thread.user_context, {
      type: body.type,
      subscriptionId:
        (response.subscriptionId as string | undefined) ?? body.subscriptionId,
      currentPeriodEnd: (response.current_period_end as number | undefined) ?? null,
      refundedCents: (response.amount as number | undefined) ?? null,
      at: new Date().toISOString(),
    });
    if (updatedCtx) {
      await patchThread(id, { user_context: updatedCtx }).catch(() => {});
    }

    return NextResponse.json({ ok: true, action: logged, response });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logAction({
      ...audit,
      response: null,
      status: "error",
      error: msg.slice(0, 500),
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
