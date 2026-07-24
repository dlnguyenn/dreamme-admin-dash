/**
 * Stripe v1 API client (bare fetch, no SDK) for support actions on the
 * DreamMe web-checkout subscriptions (RC "DreamMe (Stripe Live)" app,
 * account acct_1ThZITJ6XuUawx9T; sandbox acct_1ThZIhJGGS6rVD0f for local
 * testing via STRIPE_SECRET_KEY in .env.local).
 *
 * RC's Stripe integration observes cancellations/refunds automatically, so
 * no RevenueCat call is needed after acting here.
 *
 * Mapping note: rc_events.transaction_id for STRIPE events is a subscription
 * ITEM id (si_…) — resolve it to the parent subscription first; fall back to
 * customer search by email when the item is gone.
 */

const BASE = "https://api.stripe.com/v1";
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

function getKey(): string {
  return process.env.STRIPE_SECRET_KEY ?? "";
}

export function stripeConfigured(): boolean {
  return !!getKey();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function stripeFetch<T>(
  path: string,
  opts?: { method?: "GET" | "POST" | "DELETE"; form?: Record<string, string> },
  maxRetries = 3,
): Promise<T> {
  const key = getKey();
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  const method = opts?.method ?? "GET";
  const body = opts?.form ? new URLSearchParams(opts.form).toString() : undefined;
  let attempt = 0;
  while (true) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body,
      cache: "no-store",
    });
    if (res.ok) return (await res.json()) as T;
    const text = await res.text();
    if (!RETRYABLE.has(res.status) || attempt >= maxRetries || method !== "GET") {
      let message = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        if (parsed.error?.message) message = parsed.error.message;
      } catch {}
      throw new Error(`Stripe ${res.status}: ${message}`);
    }
    await sleep(Math.min(8000, 500 * Math.pow(2, attempt)));
    attempt++;
  }
}

// ---------------------------------------------------------------------------

export interface StripeSubscription {
  id: string; // sub_…
  status: string; // trialing | active | canceled | …
  cancel_at_period_end: boolean;
  current_period_end: number; // unix seconds
  customer: string; // cus_…
  trial_end: number | null;
  items?: { data?: Array<{ id: string; price?: { product?: string } }> };
  latest_invoice?: string | null;
}

/** si_… subscription item → parent subscription id, or null if gone. */
export async function resolveSubscriptionFromItem(
  itemId: string,
): Promise<string | null> {
  try {
    const item = await stripeFetch<{ subscription?: string }>(
      `/subscription_items/${encodeURIComponent(itemId)}`,
    );
    return item.subscription ?? null;
  } catch {
    return null;
  }
}

export async function getSubscription(
  subId: string,
): Promise<StripeSubscription> {
  return stripeFetch<StripeSubscription>(
    `/subscriptions/${encodeURIComponent(subId)}`,
  );
}

export async function findCustomersByEmail(
  email: string,
): Promise<Array<{ id: string; email: string | null }>> {
  const q = `email:'${email.replace(/'/g, "\\'")}'`;
  const res = await stripeFetch<{ data?: Array<{ id: string; email: string | null }> }>(
    `/customers/search?query=${encodeURIComponent(q)}&limit=5`,
  );
  return res.data ?? [];
}

export async function listSubscriptionsForCustomer(
  customerId: string,
): Promise<StripeSubscription[]> {
  const res = await stripeFetch<{ data?: StripeSubscription[] }>(
    `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=10`,
  );
  return res.data ?? [];
}

/**
 * Cancel a subscription. atPeriodEnd=true keeps access until the period ends
 * (right call for "cancel my trial so I don't get charged"); false revokes
 * immediately.
 */
export async function cancelSubscription(
  subId: string,
  opts: { atPeriodEnd: boolean },
): Promise<StripeSubscription> {
  if (opts.atPeriodEnd) {
    return stripeFetch<StripeSubscription>(
      `/subscriptions/${encodeURIComponent(subId)}`,
      { method: "POST", form: { cancel_at_period_end: "true" } },
    );
  }
  return stripeFetch<StripeSubscription>(
    `/subscriptions/${encodeURIComponent(subId)}`,
    { method: "DELETE" },
  );
}

export interface LatestChargeInfo {
  paymentIntentId: string | null;
  chargeId: string | null;
  amount: number; // cents
  currency: string;
  created: number; // unix seconds
  refunded: boolean;
}

/** Latest invoice's payment for a subscription (what a refund would target). */
export async function getLatestCharge(
  subId: string,
): Promise<LatestChargeInfo | null> {
  const sub = await stripeFetch<{
    latest_invoice?: {
      payment_intent?: {
        id: string;
        amount: number;
        currency: string;
        created: number;
        latest_charge?: string | { id: string; refunded?: boolean } | null;
      } | null;
      amount_paid?: number;
      currency?: string;
      created?: number;
    } | null;
  }>(
    `/subscriptions/${encodeURIComponent(subId)}?expand[]=latest_invoice.payment_intent`,
  );
  const pi = sub.latest_invoice?.payment_intent;
  if (!pi) {
    // Trials have a $0 invoice with no payment intent.
    return null;
  }
  const charge = pi.latest_charge;
  return {
    paymentIntentId: pi.id,
    chargeId: typeof charge === "string" ? charge : charge?.id ?? null,
    amount: pi.amount,
    currency: pi.currency,
    created: pi.created,
    refunded: typeof charge === "object" && !!charge?.refunded,
  };
}

export async function createRefund(params: {
  paymentIntentId: string;
  /** cents; omit for full refund */
  amount?: number;
}): Promise<{ id: string; status: string; amount: number; currency: string }> {
  const form: Record<string, string> = {
    payment_intent: params.paymentIntentId,
  };
  if (params.amount) form.amount = String(params.amount);
  return stripeFetch(`/refunds`, { method: "POST", form });
}
