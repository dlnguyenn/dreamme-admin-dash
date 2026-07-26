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
  status: string; // trialing | active | canceled | past_due | …
  cancel_at_period_end: boolean;
  /**
   * Unix seconds. NOTE: as of Stripe API 2025-03-31 (basil) and later — this
   * account defaults to 2026-05-27.dahlia — the subscription object no longer
   * carries current_period_end; it lives on each subscription ITEM. We
   * normalize it back onto the subscription in normalizeSubscription() so
   * callers (and the confirm dialog) have one stable field.
   */
  current_period_end: number;
  customer: string; // cus_…
  trial_end: number | null;
  items?: {
    data?: Array<{
      id: string;
      current_period_end?: number;
      price?: { product?: string };
    }>;
  };
  latest_invoice?: string | null;
}

/** Backfill current_period_end from the items array on newer API versions. */
export function normalizeSubscription(
  sub: StripeSubscription,
): StripeSubscription {
  if (sub.current_period_end) return sub;
  const ends = (sub.items?.data ?? [])
    .map((i) => i.current_period_end ?? 0)
    .filter(Boolean);
  return {
    ...sub,
    current_period_end: ends.length ? Math.max(...ends) : 0,
  };
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
  const sub = await stripeFetch<StripeSubscription>(
    `/subscriptions/${encodeURIComponent(subId)}`,
  );
  return normalizeSubscription(sub);
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
  return (res.data ?? []).map(normalizeSubscription);
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
  /** already fully refunded */
  refunded: boolean;
  /** cents already refunded (partial refunds) */
  amountRefunded: number;
}

export interface StripeChargeRow {
  id: string;
  payment_intent: string | null;
  amount: number;
  amount_refunded: number;
  currency: string;
  created: number;
  status: string; // succeeded | pending | failed
  refunded: boolean;
}

/**
 * The charge a refund would target: the newest SUCCEEDED charge on the
 * subscription's customer.
 *
 * Not read off the invoice: Stripe removed invoice.payment_intent and
 * invoice.charge in recent API versions (this account is on
 * 2026-05-27.dahlia), so expanding latest_invoice.payment_intent returns
 * null for everyone. Listing the customer's charges works across versions.
 *
 * Failed charges are excluded on purpose — a past_due subscriber can have
 * several failed retry charges for the same payment intent, and refunding
 * one of those is meaningless.
 *
 * Returns null when there is nothing refundable (trial that never paid, or
 * every charge already refunded).
 */
/** Net cents actually collected from a customer (succeeded minus refunds). */
export async function sumPaidForCustomer(customerId: string): Promise<number> {
  const res = await stripeFetch<{ data?: StripeChargeRow[] }>(
    `/charges?customer=${encodeURIComponent(customerId)}&limit=100`,
  );
  return (res.data ?? [])
    .filter((c) => c.status === "succeeded")
    .reduce((sum, c) => sum + (c.amount - c.amount_refunded), 0);
}

export function pickRefundableCharge(
  charges: StripeChargeRow[],
): StripeChargeRow | null {
  const refundable = charges
    .filter((c) => c.status === "succeeded" && c.amount > c.amount_refunded)
    .sort((a, b) => b.created - a.created);
  return refundable[0] ?? null;
}

export async function getLatestCharge(
  subId: string,
): Promise<LatestChargeInfo | null> {
  const sub = await getSubscription(subId);
  if (!sub.customer) return null;
  const res = await stripeFetch<{ data?: StripeChargeRow[] }>(
    `/charges?customer=${encodeURIComponent(sub.customer)}&limit=20`,
  );
  const charge = pickRefundableCharge(res.data ?? []);
  if (!charge) return null;
  return {
    paymentIntentId: charge.payment_intent,
    chargeId: charge.id,
    amount: charge.amount,
    currency: charge.currency,
    created: charge.created,
    refunded: charge.refunded,
    amountRefunded: charge.amount_refunded,
  };
}

/**
 * Refund by charge id when we have one (precise — a payment intent with
 * failed retries can map to several charges), else by payment intent.
 */
export async function createRefund(params: {
  chargeId?: string | null;
  paymentIntentId?: string | null;
  /** cents; omit for full refund */
  amount?: number;
}): Promise<{ id: string; status: string; amount: number; currency: string }> {
  const form: Record<string, string> = {};
  if (params.chargeId) form.charge = params.chargeId;
  else if (params.paymentIntentId) form.payment_intent = params.paymentIntentId;
  else throw new Error("createRefund needs a chargeId or paymentIntentId");
  if (params.amount) form.amount = String(params.amount);
  return stripeFetch(`/refunds`, { method: "POST", form });
}
