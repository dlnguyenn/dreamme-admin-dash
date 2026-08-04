/**
 * Support Inbox — apply a successful subscription action's KNOWN effect to
 * the thread's user_context snapshot, so the sidebar flips immediately
 * (Active → Closed, "won't renew", reduced paid total) instead of waiting
 * for RevenueCat's webhook to catch up minutes later. Pure — unit-tested.
 */
import type {
  SubscriptionInfo,
  SupportActionRow,
  SupportActionType,
  UserContext,
} from "./types";

/**
 * The successful actions already taken for this user, newest first, keyed
 * by type — money actions must not be repeatable by accident. Errors do
 * NOT count: a failed refund should stay retryable. Pure, unit-tested.
 */
export function completedActions(
  actions: SupportActionRow[],
): Map<SupportActionType, SupportActionRow> {
  const done = new Map<SupportActionType, SupportActionRow>();
  for (const a of actions) {
    if (a.status !== "success") continue;
    const type = a.action_type as SupportActionType;
    const prev = done.get(type);
    if (!prev || new Date(a.created_at) > new Date(prev.created_at)) {
      done.set(type, a);
    }
  }
  return done;
}

export interface ActionLock {
  disabled: boolean;
  /** short reason shown under the button, e.g. "Refunded 2h ago" */
  reason: string | null;
  /** ISO timestamp of the prior successful run, when that's the cause */
  at: string | null;
}

const LABELS: Record<SupportActionType, string> = {
  stripe_cancel_at_period_end: "Cancelled at period end",
  stripe_cancel_now: "Cancelled",
  stripe_refund: "Refunded",
  rc_play_refund_revoke: "Refunded & revoked",
  trello_create_card: "Ticket created",
};

/**
 * Whether an action button should be locked. Two independent reasons:
 *  - it already succeeded for this user (per type, so cancel-at-period-end
 *    having run still leaves the cancel-now escalation available)
 *  - there is nothing left to act on (cancels on an inactive subscription)
 */
export function actionLock(
  type: SupportActionType,
  sub: SubscriptionInfo | null,
  actions: SupportActionRow[],
): ActionLock {
  const done = completedActions(actions).get(type);
  if (done) {
    return { disabled: true, reason: LABELS[type], at: done.created_at };
  }
  const isCancel =
    type === "stripe_cancel_now" || type === "stripe_cancel_at_period_end";
  if (isCancel && sub && !sub.isActive) {
    return { disabled: true, reason: "Subscription already ended", at: null };
  }
  if (type === "stripe_cancel_at_period_end" && sub?.autoRenew === false && sub?.isActive) {
    return { disabled: true, reason: "Already set to not renew", at: null };
  }
  return { disabled: false, reason: null, at: null };
}

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
