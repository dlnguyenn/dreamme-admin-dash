/**
 * Support Inbox — apply a successful subscription action's KNOWN effect to
 * the thread's user_context snapshot, so the sidebar flips immediately
 * (Active → Closed, "won't renew", reduced paid total) instead of waiting
 * for RevenueCat's webhook to catch up minutes later. Pure — unit-tested.
 */
import type { SubscriptionInfo, UserContext } from "./types";

export interface ActionEffectInput {
  type:
    | "stripe_cancel_now"
    | "stripe_cancel_at_period_end"
    | "stripe_refund"
    | "rc_play_refund_revoke";
  /** sub_… the cancel acted on (matches originalTransactionId on
   *  Stripe-fallback contexts; rc_events contexts match by store) */
  subscriptionId?: string | null;
  /** normalized unix seconds, for the at-period-end path */
  currentPeriodEnd?: number | null;
  /** refund amount in cents */
  refundedCents?: number | null;
  /** ISO timestamp of the action (passed in — keeps the fn pure) */
  at: string;
}

export function applyActionToContext(
  ctx: UserContext | null,
  effect: ActionEffectInput,
): UserContext | null {
  if (!ctx || ctx.subscriptions.length === 0) return null;
  const store = effect.type === "rc_play_refund_revoke" ? "PLAY_STORE" : "STRIPE";

  // Prefer an exact sub_… match (Stripe-fallback contexts store it as
  // originalTransactionId); otherwise the first subscription on that store —
  // rc_events contexts carry store transaction ids the Stripe response
  // can't reference.
  const inStore = ctx.subscriptions.filter((s) => s.store === store);
  const target =
    (effect.subscriptionId &&
      inStore.find((s) => s.originalTransactionId === effect.subscriptionId)) ||
    inStore[0];
  if (!target) return null; // nothing to update — leave the snapshot alone

  let paidDelta = 0;
  const subscriptions = ctx.subscriptions.map((sub) => {
    if (sub !== target) return sub;
    switch (effect.type) {
      case "stripe_cancel_now":
        return {
          ...sub,
          isActive: false,
          autoRenew: false,
          expiresAt: effect.at,
          lastEventType: "dash:cancelled_now",
          lastEventAt: effect.at,
        };
      case "stripe_cancel_at_period_end":
        return {
          ...sub,
          autoRenew: false, // isActive stays — access runs to period end
          expiresAt: effect.currentPeriodEnd
            ? new Date(effect.currentPeriodEnd * 1000).toISOString()
            : sub.expiresAt,
          lastEventType: "dash:cancel_at_period_end",
          lastEventAt: effect.at,
        };
      case "stripe_refund": {
        const refund = (effect.refundedCents ?? 0) / 100;
        paidDelta = -Math.min(refund, sub.totalPaidUsd);
        return {
          ...sub,
          totalPaidUsd: Math.max(0, sub.totalPaidUsd - refund),
          lastEventType: "dash:refunded",
          lastEventAt: effect.at,
        };
      }
      case "rc_play_refund_revoke":
        return {
          ...sub,
          isActive: false,
          autoRenew: false,
          expiresAt: effect.at,
          cancelReason: "CUSTOMER_SUPPORT",
          lastEventType: "dash:refund_revoked",
          lastEventAt: effect.at,
        };
    }
  });

  return {
    ...ctx,
    subscriptions,
    totalSpentUsd: Math.max(0, ctx.totalSpentUsd + paidDelta),
  };
}
