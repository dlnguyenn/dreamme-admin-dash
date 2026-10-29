import { describe, expect, it } from "vitest";
import {
  askedForDiscount,
  iphoneSignal,
  offerCodeReply,
} from "@/lib/support/offer-codes";
import type { SubscriptionInfo, UserContext } from "@/lib/support/types";

const msg = (body: string, direction: "inbound" | "outbound" = "inbound") => ({
  direction,
  body_text: body,
  body_html: null,
});

const sub = (fields: Partial<SubscriptionInfo>): SubscriptionInfo => ({
  store: "APP_STORE",
  productId: "monthly",
  transactionId: "t1",
  originalTransactionId: "o1",
  periodType: "NORMAL",
  isTrial: false,
  lastEventType: "RENEWAL",
  lastEventAt: "2026-10-01T00:00:00Z",
  expiresAt: "2026-11-01T00:00:00Z",
  cancelReason: null,
  isActive: true,
  totalPaidUsd: 50,
  plan: "monthly",
  startedAt: "2026-05-01T00:00:00Z",
  autoRenew: true,
  renewals: 5,
  ...fields,
});

const ctx = (fields: Partial<UserContext> = {}): UserContext => ({
  appUserId: "u1",
  email: "jen@example.com",
  name: "Jennifer",
  journeyStage: null,
  subscriptions: [],
  totalSpentUsd: 0,
  noAccount: false,
  sandboxOnly: false,
  ...fields,
});

const base = {
  counterpart_email: "jen@example.com",
  counterpart_name: "Jenn McQuaid",
  resolved_store: null,
  user_context: null,
  triage: null,
};

describe("askedForDiscount", () => {
  it("trusts the triage flag", () => {
    expect(askedForDiscount({ triage: { discount_request: true } as never }, [])).toBe(true);
  });

  it("falls back to what the customer wrote on older threads", () => {
    expect(
      askedForDiscount(base, [
        msg("Do you offer any loyalty discounts or retention offers? $9.99 is becoming expensive."),
      ]),
    ).toBe(true);
    expect(askedForDiscount(base, [msg("Is there a promo code for the yearly plan?")])).toBe(true);
  });

  it("ignores our own offer quoted back in their reply", () => {
    expect(
      askedForDiscount(base, [
        msg("Thanks, how do I log my shot?\n\nOn Oct 29, 2026, at 2:04 PM, Dan wrote:\nI'd love to offer you a discount!"),
        msg("I'd love to offer you a discount!", "outbound"),
      ]),
    ).toBe(false);
  });

  it("never fires on spam or plain how-to mail", () => {
    expect(askedForDiscount({ triage: { is_spam: true } as never }, [msg("50% discount on ads!")])).toBe(false);
    expect(askedForDiscount(base, [msg("How do I change my shot day?")])).toBe(false);
  });
});

describe("iphoneSignal", () => {
  it("is yes for App Store subscribers and Hide My Email senders", () => {
    expect(iphoneSignal({ ...base, resolved_store: "APP_STORE" }, []).ios).toBe("yes");
    expect(
      iphoneSignal({ ...base, counterpart_email: "abc@privaterelay.appleid.com" }, []).ios,
    ).toBe("yes");
  });

  it("is no for Play and web subscribers, even writing from an iPhone", () => {
    const play = { ...base, user_context: ctx({ subscriptions: [sub({ store: "PLAY_STORE" })] }) };
    expect(iphoneSignal(play, [msg("Sent from my iPhone")]).ios).toBe("no");
    expect(iphoneSignal({ ...base, resolved_store: "STRIPE" }, [msg("Sent from my iPhone")]).ios).toBe("no");
  });

  it("uses the mail signature for unmatched senders", () => {
    expect(iphoneSignal(base, [msg("Thank you!\n\nSent from my iPhone")]).ios).toBe("yes");
    expect(iphoneSignal(base, [msg("Thank you!")]).ios).toBe("unknown");
  });
});

describe("offerCodeReply", () => {
  const code = { code: "ABC123", redeem_url: "https://apps.apple.com/redeem?ctx=offercodes&id=1&code=ABC123" };

  it("greets by first name, links the code and signs off as Dan", () => {
    const text = offerCodeReply(base, code);
    expect(text.startsWith("Hi Jenn!")).toBe(true);
    expect(text).toContain(code.redeem_url);
    expect(text).toContain("ABC123");
    expect(text).toContain("$39.99");
    expect(text.endsWith("Dan, co-founder of DreamMe")).toBe(true);
    expect(text).not.toMatch(/[–—]/);
  });

  it("tells a live subscriber to cancel first so they aren't billed twice", () => {
    const text = offerCodeReply({ ...base, user_context: ctx({ subscriptions: [sub({})] }) }, code);
    expect(text).toContain("please cancel your current subscription");
  });

  it("hedges when the account is unknown, and skips it when nothing is live", () => {
    expect(offerCodeReply(base, code)).toContain("if you have a monthly or quarterly subscription");
    const lapsed = { ...base, user_context: ctx({ subscriptions: [sub({ isActive: false })] }) };
    expect(offerCodeReply(lapsed, code)).not.toContain("cancel");
  });

  it("reuses the name Dan already greeted them with", () => {
    const text = offerCodeReply(base, code, [
      msg("Hi! Any loyalty discounts?\n\nJennifer McQuaid"),
      msg("Hi Jennifer!\n\nI'd love to offer you $39.99!", "outbound"),
    ]);
    expect(text).toMatch(/^Hi Jennifer!/);
  });

  it("falls back to 'there' for handle-like names", () => {
    expect(offerCodeReply({ ...base, counterpart_name: "joejenmc@hotmail.com" }, code)).toMatch(/^Hi there!/);
  });
});
