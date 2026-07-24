import { describe, expect, it } from "vitest";
import { cleanDraft, isDeniedSender, isInternalSender } from "@/lib/support/triage";
import { normalizeSubject } from "@/lib/support/ingest";
import { deriveSubscriptions } from "@/lib/support/resolve-user";
import { replySubject } from "@/lib/support/mailer";

describe("cleanDraft", () => {
  it("strips em and en dashes", () => {
    const out = cleanDraft("Thanks — that helps. Trial ends Aug 3–4.\n\nDan, co-founder of DreamMe");
    expect(out).not.toMatch(/[—–]/);
  });

  it("appends the sign-off when missing", () => {
    const out = cleanDraft("Thanks for reaching out!");
    expect(out.endsWith("Dan, co-founder of DreamMe")).toBe(true);
  });

  it("does not duplicate an existing sign-off", () => {
    const out = cleanDraft("All set.\n\nDan, co-founder of DreamMe");
    expect(out.match(/co-founder of DreamMe/g)?.length).toBe(1);
  });
});

describe("deny-list", () => {
  it("denies TestFlight and bounce senders", () => {
    expect(isDeniedSender("no-reply@testflight.apple.com", "DreamMe is now available to test")).toBe(true);
    expect(isDeniedSender("mailer-daemon@googlemail.com", "Delivery Status Notification (Failure)")).toBe(true);
  });

  it("allows real users", () => {
    expect(isDeniedSender("jane.doe@gmail.com", "please cancel my trial")).toBe(false);
  });

  it("flags Dan's own addresses as internal, not denied", () => {
    expect(isInternalSender("dan@dreamme.life")).toBe(true);
    expect(isDeniedSender("dan@dreamme.life", "test")).toBe(false);
  });
});

describe("normalizeSubject", () => {
  it("strips stacked Re:/Fwd: prefixes and casefolds", () => {
    expect(normalizeSubject("Re: RE: Fwd: Refund please")).toBe("refund please");
    expect(normalizeSubject(null)).toBe("");
  });
});

describe("replySubject", () => {
  it("adds Re: once", () => {
    expect(replySubject("Cancel my trial")).toBe("Re: Cancel my trial");
    expect(replySubject("Re: Cancel my trial")).toBe("Re: Cancel my trial");
    expect(replySubject(null)).toBe("Re: your message to DreamMe");
  });
});

describe("deriveSubscriptions", () => {
  const base = {
    store: "STRIPE",
    environment: "PRODUCTION",
    product_id: "prod_x",
    period_type: "TRIAL",
    transaction_id: "si_1",
    original_transaction_id: "si_1",
    cancel_reason: null,
  };

  it("derives an active trial from an INITIAL_PURCHASE", () => {
    const future = new Date(Date.now() + 3 * 86400_000).toISOString();
    const { subscriptions } = deriveSubscriptions([
      { ...base, type: "INITIAL_PURCHASE", event_at: "2026-07-20T00:00:00Z", price_usd: 0, expiration_at: future },
    ]);
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].isTrial).toBe(true);
    expect(subscriptions[0].isActive).toBe(true);
    expect(subscriptions[0].store).toBe("STRIPE");
  });

  it("sums payments and subtracts support refunds", () => {
    const past = "2026-01-01T00:00:00Z";
    const { totalSpentUsd } = deriveSubscriptions([
      { ...base, period_type: "NORMAL", type: "INITIAL_PURCHASE", event_at: "2025-11-01T00:00:00Z", price_usd: 15, expiration_at: past },
      { ...base, period_type: "NORMAL", type: "RENEWAL", event_at: "2025-12-01T00:00:00Z", price_usd: 15, expiration_at: past },
      { ...base, period_type: "NORMAL", type: "CANCELLATION", event_at: "2025-12-05T00:00:00Z", price_usd: 15, cancel_reason: "CUSTOMER_SUPPORT", expiration_at: past },
    ]);
    expect(totalSpentUsd).toBe(15);
  });

  it("ignores sandbox events and flags sandboxOnly", () => {
    const { subscriptions, sandboxOnly } = deriveSubscriptions([
      { ...base, environment: "SANDBOX", type: "INITIAL_PURCHASE", event_at: "2026-07-20T00:00:00Z", price_usd: 0, expiration_at: null },
    ]);
    expect(subscriptions).toHaveLength(0);
    expect(sandboxOnly).toBe(true);
  });

  it("groups multiple subscriptions by original transaction", () => {
    const past = "2026-01-01T00:00:00Z";
    const { subscriptions } = deriveSubscriptions([
      { ...base, type: "INITIAL_PURCHASE", event_at: "2025-10-01T00:00:00Z", price_usd: 0, expiration_at: past },
      { ...base, store: "APP_STORE", transaction_id: "t2", original_transaction_id: "t2", type: "INITIAL_PURCHASE", event_at: "2026-07-01T00:00:00Z", price_usd: 0, expiration_at: past },
    ]);
    expect(subscriptions).toHaveLength(2);
    // newest activity first
    expect(subscriptions[0].store).toBe("APP_STORE");
  });
});
