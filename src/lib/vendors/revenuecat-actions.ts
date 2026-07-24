/**
 * RevenueCat v2 API — subscription ACTIONS (refund/revoke) for support.
 *
 * Uses the same v2 secret key as the metrics client (REVENUECAT_API_KEY) —
 * verified 2026-07-24 to carry customer_information:subscriptions:read_write
 * (a permission probe on a nonexistent subscription returns 404, not 403).
 *
 * Play Store refunds: POST /v2/projects/{p}/subscriptions/{sub}/actions/
 * refund_transaction — refunds the latest transaction AND revokes access.
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

async function rcPost<T>(path: string): Promise<T> {
  const key = getKey();
  const projectId = getProjectId();
  if (!key || !projectId) throw new Error("REVENUECAT_API_KEY / PROJECT_ID not set");
  const res = await fetch(`${BASE}/projects/${projectId}${path}`, {
    method: "POST",
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

export interface PlayRefundResult {
  subscriptionId: string;
  response: unknown;
}

/**
 * Refund the latest Play Store transaction and revoke access.
 * Resolves the customer's v2 subscription id first (a Play user has at most
 * one subscription in practice; prefers the one currently giving access).
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
  const response = await rcPost<unknown>(
    `/subscriptions/${encodeURIComponent(target.id)}/actions/refund_transaction`,
  );
  return { subscriptionId: target.id, response };
}
