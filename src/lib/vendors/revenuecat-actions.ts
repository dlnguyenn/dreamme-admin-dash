/**
 * RevenueCat v2 API — subscription ACTIONS (refund/revoke) for support.
 *
 * Uses the same v2 secret key as the metrics client (REVENUECAT_API_KEY) —
 * carries customer_information:subscriptions:read_write.
 *
 * Play Store refunds are TRANSACTION-scoped in v2:
 *   GET  /v2/projects/{p}/subscriptions/{sub}/transactions   → latest txn id
 *   POST /v2/projects/{p}/subscriptions/{sub}/transactions/{GPA.…}/actions/refund
 * which refunds that transaction AND revokes access. There is no
 * subscription-level Play refund action — /actions/refund exists but is Web
 * Billing only, and the previously used /actions/refund_transaction does not
 * exist at all (RC answers 404 "Resource not found" for unknown action paths,
 * which is also why the old 404-based permission probe proved nothing).
 * Apple has no refund API anywhere; Stripe-store subs go through the Stripe
 * API directly (see vendors/stripe.ts).
 */
import {
  getCustomerSubscriptions,
  revenueCatConfigured,
  type CustomerSubscriptionRow,
} from "./revenuecat";

const BASE = "https://api.revenuecat.com/v2";

export { revenueCatConfigured };

function getKey(): string {
  return process.env.REVENUECAT_API_KEY ?? "";
}
function getProjectId(): string {
  return process.env.REVENUECAT_PROJECT_ID ?? "";
}

async function rcRequest<T>(path: string, method: "GET" | "POST"): Promise<T> {
  const key = getKey();
  const projectId = getProjectId();
  if (!key || !projectId) throw new Error("REVENUECAT_API_KEY / PROJECT_ID not set");
  const res = await fetch(`${BASE}/projects/${projectId}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as
    | { message?: string }
    | null;
  if (!res.ok) {
    throw new Error(
      `RevenueCat v2 ${res.status}: ${body?.message ?? "request failed"}`,
    );
  }
  return body as T;
}

interface SubscriptionTransactionRow {
  id: string; // the STORE's transaction id, e.g. GPA.0000-0000-0000-00000
  purchased_at: number;
  product_store_identifier: string;
  revenue_in_usd?: { gross?: number | null } | null;
}

export interface PlayRefundResult {
  subscriptionId: string;
  transactionId: string;
  response: unknown;
}

/**
 * Refund the latest Play Store transaction and revoke access.
 * Resolves the customer's v2 subscription id, then that subscription's most
 * recent store transaction (a Play user has at most one subscription in
 * practice; prefers the one currently giving access).
 */
export async function refundAndRevokePlaySubscription(
  appUserId: string,
): Promise<PlayRefundResult> {
  const subs = await getCustomerSubscriptions(appUserId);
  const play: CustomerSubscriptionRow[] = subs.filter(
    (s) => s.store === "play_store",
  );
  if (play.length === 0) {
    throw new Error("No Play Store subscription found for this user in RevenueCat");
  }
  const target =
    play.find((s) => s.gives_access) ??
    play.sort(
      (a, b) => (b.current_period_ends_at ?? 0) - (a.current_period_ends_at ?? 0),
    )[0];
  const txns = await rcRequest<{ items?: SubscriptionTransactionRow[] }>(
    `/subscriptions/${encodeURIComponent(target.id)}/transactions?sort=purchased_at&direction=desc&limit=1`,
    "GET",
  );
  const latest = txns.items?.[0];
  if (!latest) {
    throw new Error(
      "No store transactions found on the Play subscription in RevenueCat",
    );
  }
  const response = await rcRequest<unknown>(
    `/subscriptions/${encodeURIComponent(target.id)}/transactions/${encodeURIComponent(latest.id)}/actions/refund`,
    "POST",
  );
  return { subscriptionId: target.id, transactionId: latest.id, response };
}
