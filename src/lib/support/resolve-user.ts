/**
 * Support Inbox — resolve an email address to a DreamMe account and its live
 * subscription state.
 *
 * Chain: email → consumer public.users (id == RC app_user_id) → internal
 * rc_events (webhook-fed, reliable) grouped by original_transaction_id →
 * RC v2 API subscriptions as fallback when no production events exist.
 */
import { spGet } from "./db";
import { findUserByEmail, getUserById } from "./consumer-db";
import {
  getCustomerSubscriptions,
  revenueCatConfigured,
} from "@/lib/vendors/revenuecat";
import type { Store, SubscriptionInfo, UserContext } from "./types";

interface RcEventLite {
  type: string;
  event_at: string;
  store: string | null;
  environment: string | null;
  product_id: string | null;
  period_type: string | null;
  transaction_id: string | null;
  original_transaction_id: string | null;
  price_usd: number | null;
  cancel_reason: string | null;
  expiration_at: string | null;
}

const PAYMENT_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "NON_RENEWING_PURCHASE",
]);

export const EMPTY_CONTEXT: UserContext = {
  appUserId: null,
  email: null,
  name: null,
  journeyStage: null,
  subscriptions: [],
  totalSpentUsd: 0,
  noAccount: true,
  sandboxOnly: false,
};

/**
 * Pure derivation from rc_events rows (newest-first NOT required; sorted
 * internally). Exported for unit tests.
 */
export function deriveSubscriptions(events: RcEventLite[]): {
  subscriptions: SubscriptionInfo[];
  totalSpentUsd: number;
  sandboxOnly: boolean;
} {
  const prod = events.filter((e) => e.environment === "PRODUCTION");
  const sandboxOnly = prod.length === 0 && events.length > 0;
  const groups = new Map<string, RcEventLite[]>();
  for (const e of prod) {
    const key = e.original_transaction_id ?? e.transaction_id ?? e.product_id ?? "?";
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }

  let totalSpentUsd = 0;
  const subscriptions: SubscriptionInfo[] = [];
  const now = Date.now();

  for (const [key, group] of groups) {
    group.sort(
      (a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime(),
    );
    const latest = group[group.length - 1];
    let paid = 0;
    for (const e of group) {
      if (PAYMENT_TYPES.has(e.type)) paid += Number(e.price_usd) || 0;
      // Refund posted by support shows as CANCELLATION w/ CUSTOMER_SUPPORT
      if (e.type === "CANCELLATION" && e.cancel_reason === "CUSTOMER_SUPPORT") {
        paid -= Number(e.price_usd) || 0;
      }
    }
    totalSpentUsd += paid;
    const expiresAt = latest.expiration_at;
    subscriptions.push({
      store: (latest.store ?? "?") as Store,
      productId: latest.product_id,
      transactionId: latest.transaction_id,
      originalTransactionId: latest.original_transaction_id ?? key,
      periodType: latest.period_type,
      isTrial: latest.period_type === "TRIAL",
      lastEventType: latest.type,
      lastEventAt: latest.event_at,
      expiresAt,
      cancelReason: latest.cancel_reason,
      isActive: !!expiresAt && new Date(expiresAt).getTime() > now,
      totalPaidUsd: Math.max(0, paid),
    });
  }

  // Most-recent activity first
  subscriptions.sort(
    (a, b) =>
      new Date(b.lastEventAt).getTime() - new Date(a.lastEventAt).getTime(),
  );
  return { subscriptions, totalSpentUsd: Math.max(0, totalSpentUsd), sandboxOnly };
}

async function fetchRcEvents(appUserId: string): Promise<RcEventLite[]> {
  return spGet<RcEventLite[]>(
    `rc_events?or=(app_user_id.eq.${encodeURIComponent(appUserId)},original_app_user_id.eq.${encodeURIComponent(appUserId)})` +
      `&select=type,event_at,store,environment,product_id,period_type,transaction_id,original_transaction_id,price_usd,cancel_reason,expiration_at` +
      `&order=event_at.desc&limit=200`,
  );
}

/** RC v2 store names → webhook-style store names used everywhere else. */
function normalizeStore(v2store: string): string {
  const map: Record<string, string> = {
    app_store: "APP_STORE",
    play_store: "PLAY_STORE",
    stripe: "STRIPE",
    rc_billing: "RC_BILLING",
    amazon: "AMAZON",
  };
  return map[v2store] ?? v2store.toUpperCase();
}

export async function resolveUser(
  email: string | null,
  knownUserId?: string | null,
): Promise<UserContext> {
  const user = knownUserId
    ? await getUserById(knownUserId).catch(() => null)
    : email
      ? await findUserByEmail(email).catch(() => null)
      : null;
  if (!user) {
    return { ...EMPTY_CONTEXT, email: email?.toLowerCase() ?? null };
  }

  const events = await fetchRcEvents(user.id).catch(() => [] as RcEventLite[]);
  let derived = deriveSubscriptions(events);

  // Fallback: no production webhook events → ask RC v2 directly.
  if (derived.subscriptions.length === 0 && revenueCatConfigured()) {
    try {
      const subs = await getCustomerSubscriptions(user.id);
      const mapped: SubscriptionInfo[] = subs.map((s) => ({
        store: normalizeStore(s.store) as Store,
        productId: s.product_id,
        transactionId: s.store_subscription_identifier,
        originalTransactionId: s.store_subscription_identifier,
        periodType: s.status === "trialing" ? "TRIAL" : "NORMAL",
        isTrial: s.status === "trialing",
        lastEventType: `rc_v2:${s.status}`,
        lastEventAt: new Date().toISOString(),
        expiresAt: s.current_period_ends_at
          ? new Date(s.current_period_ends_at).toISOString()
          : null,
        cancelReason: null,
        isActive: s.gives_access,
        totalPaidUsd: Number(s.total_revenue_in_usd?.gross) || 0,
      }));
      derived = {
        subscriptions: mapped,
        totalSpentUsd: mapped.reduce((a, s) => a + s.totalPaidUsd, 0),
        sandboxOnly: derived.sandboxOnly,
      };
    } catch {
      // keep rc_events-derived (empty) state
    }
  }

  return {
    appUserId: user.id,
    email: user.email?.toLowerCase() ?? email?.toLowerCase() ?? null,
    name: user.name,
    journeyStage: user.glp1_journey_stage,
    subscriptions: derived.subscriptions,
    totalSpentUsd: derived.totalSpentUsd,
    noAccount: false,
    sandboxOnly: derived.sandboxOnly,
  };
}
