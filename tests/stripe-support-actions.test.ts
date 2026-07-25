import { describe, expect, it } from "vitest";
import {
  normalizeSubscription,
  pickRefundableCharge,
  type StripeChargeRow,
  type StripeSubscription,
} from "@/lib/vendors/stripe";

// Regression tests for Stripe API version 2025-03-31 (basil) and later —
// the DreamMe account defaults to 2026-05-27.dahlia. Two breaking changes
// bit the support actions:
//   1. subscription.current_period_end moved onto subscription items
//   2. invoice.payment_intent / invoice.charge were removed

describe("normalizeSubscription", () => {
  const base = {
    id: "sub_1",
    status: "trialing",
    cancel_at_period_end: false,
    customer: "cus_1",
    trial_end: null,
  };

  it("backfills current_period_end from items (dahlia shape)", () => {
    const sub = normalizeSubscription({
      ...base,
      current_period_end: undefined as unknown as number,
      items: { data: [{ id: "si_1", current_period_end: 1785095047 }] },
    } as StripeSubscription);
    expect(sub.current_period_end).toBe(1785095047);
    expect(Number.isNaN(new Date(sub.current_period_end * 1000).getTime())).toBe(false);
  });

  it("keeps a subscription-level value when present (older versions)", () => {
    const sub = normalizeSubscription({
      ...base,
      current_period_end: 111,
      items: { data: [{ id: "si_1", current_period_end: 999 }] },
    } as StripeSubscription);
    expect(sub.current_period_end).toBe(111);
  });

  it("takes the latest item period end with multiple items", () => {
    const sub = normalizeSubscription({
      ...base,
      current_period_end: 0,
      items: {
        data: [
          { id: "si_a", current_period_end: 500 },
          { id: "si_b", current_period_end: 900 },
        ],
      },
    } as StripeSubscription);
    expect(sub.current_period_end).toBe(900);
  });

  it("degrades to 0 rather than NaN when Stripe sends no period at all", () => {
    const sub = normalizeSubscription({
      ...base,
      current_period_end: undefined as unknown as number,
    } as StripeSubscription);
    expect(sub.current_period_end).toBe(0);
  });
});

describe("pickRefundableCharge", () => {
  const charge = (over: Partial<StripeChargeRow>): StripeChargeRow => ({
    id: "ch_x",
    payment_intent: "pi_x",
    amount: 6999,
    amount_refunded: 0,
    currency: "usd",
    created: 1000,
    status: "succeeded",
    refunded: false,
    ...over,
  });

  it("returns null for a trial with no charges", () => {
    expect(pickRefundableCharge([])).toBeNull();
  });

  it("ignores failed retry charges on a past_due subscriber", () => {
    // Real shape seen on the live account: 4 failed charges, same PI.
    const charges = [1, 2, 3, 4].map((i) =>
      charge({ id: `ch_${i}`, status: "failed", created: 1000 + i }),
    );
    expect(pickRefundableCharge(charges)).toBeNull();
  });

  it("picks the newest succeeded charge", () => {
    const picked = pickRefundableCharge([
      charge({ id: "ch_old", created: 100 }),
      charge({ id: "ch_new", created: 900 }),
      charge({ id: "ch_failed", created: 950, status: "failed" }),
    ]);
    expect(picked?.id).toBe("ch_new");
  });

  it("skips fully refunded charges but allows partially refunded ones", () => {
    expect(
      pickRefundableCharge([charge({ amount: 6999, amount_refunded: 6999 })]),
    ).toBeNull();
    const partial = pickRefundableCharge([
      charge({ id: "ch_partial", amount: 6999, amount_refunded: 1000 }),
    ]);
    expect(partial?.id).toBe("ch_partial");
  });
});
