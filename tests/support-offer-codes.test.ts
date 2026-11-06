import { describe, expect, it } from "vitest";
import {
  addPearlPackToReply,
  askedForDiscount,
  iphoneSignal,
  isExpiredCode,
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

  it("tells a live subscriber the code switches their plan, no cancelling", () => {
    const text = offerCodeReply({ ...base, user_context: ctx({ subscriptions: [sub({})] }) }, code);
    expect(text).toContain("No need to cancel anything first");
    expect(text).not.toMatch(/please cancel/i);
  });

  it("hedges when the account is unknown, and skips it when nothing is live", () => {
    expect(offerCodeReply(base, code)).toContain("If you're on a monthly or quarterly plan right now");
    const lapsed = { ...base, user_context: ctx({ subscriptions: [sub({ isActive: false })] }) };
    expect(offerCodeReply(lapsed, code)).not.toMatch(/cancel/i);
  });

  it("reuses the name Dan already greeted them with", () => {
    const text = offerCodeReply(base, code, [
      msg("Hi! Any loyalty discounts?\n\nJennifer McQuaid"),
      msg("Hi Jennifer!\n\nI'd love to offer you $39.99!", "outbound"),
    ]);
    expect(text).toMatch(/^Hi Jennifer!/);
  });

  it("anchors on the regular price and only makes claims about the code", () => {
    const text = offerCodeReply(base, code);
    expect(text).toContain("from $69.99 down to $39.99");
    expect(text).toContain("It only works once");
    expect(text).toContain("it's not something we do often");
    expect(text).not.toMatch(/exclusive|lowest|best price|expires|hurry|only today/i);
  });

  it("only thanks people for staying when they are actually subscribed", () => {
    expect(offerCodeReply(base, code)).not.toMatch(/been with us|having you with us|sticking/i);
    const lapsed = { ...base, user_context: ctx({ subscriptions: [sub({ isActive: false })] }) };
    expect(offerCodeReply(lapsed, code)).not.toMatch(/been with us|having you with us|sticking/i);
    const live = { ...base, user_context: ctx({ subscriptions: [sub({})] }) };
    expect(offerCodeReply(live, code)).toContain("Having you with us");
  });

  it("names how long a subscriber has been with us when the account is old enough", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    const at = (accountCreatedAt: string) => ({
      ...base,
      user_context: ctx({ subscriptions: [sub({})], accountCreatedAt }),
    });
    expect(offerCodeReply(at("2026-03-14T00:00:00Z"), code, [], [], now)).toContain("You've been with us since March");
    expect(offerCodeReply(at("2025-02-01T00:00:00Z"), code, [], [], now)).toContain("You've been with us for over a year");
    expect(offerCodeReply(at("2026-10-20T00:00:00Z"), code, [], [], now)).toContain("Having you with us");
  });

  it("borrows the first name from an AI draft when the thread has no usable name", () => {
    const bare = { ...base, counterpart_name: null, user_context: null };
    expect(offerCodeReply(bare, code, [], ["Hi Felicia! We don't list promo codes."])).toMatch(/^Hi Felicia!/);
    expect(offerCodeReply(bare, code, [], ["Hi there! Thanks."])).toMatch(/^Hi there!/);
    // A real name on the thread still beats a draft's guess.
    expect(offerCodeReply(base, code, [], ["Hi Felicia!"])).toMatch(/^Hi Jenn!/);
  });

  it("falls back to 'there' for handle-like names", () => {
    expect(offerCodeReply({ ...base, counterpart_name: "joejenmc@hotmail.com" }, code)).toMatch(/^Hi there!/);
  });
});

describe("addPearlPackToReply", () => {
  const pearl = { code: "PEARL1", redeem_url: "https://apps.apple.com/redeem?ctx=offercodes&id=1&code=PEARL1" };
  const draft = "Hi Sam! Love this idea, I've passed it to the team!\n\nDan, co-founder of DreamMe";

  it("slots the gift above the sign-off of the reply being written", () => {
    const out = addPearlPackToReply(draft, base, pearl);
    expect(out.startsWith("Hi Sam! Love this idea")).toBe(true);
    expect(out.indexOf(pearl.redeem_url)).toBeLessThan(out.indexOf("Dan, co-founder of DreamMe"));
    expect(out).toContain("550 pearls");
    expect(out.endsWith("Dan, co-founder of DreamMe")).toBe(true);
    expect(out).not.toMatch(/[–—]/);
  });

  it("is a no-op the second time", () => {
    const once = addPearlPackToReply(draft, base, pearl);
    expect(addPearlPackToReply(once, base, pearl)).toBe(once);
  });

  it("appends when there is no sign-off, and writes a full thank-you when empty", () => {
    expect(addPearlPackToReply("Thanks!", base, pearl).startsWith("Thanks!\n\nAs a little thank you")).toBe(true);
    const full = addPearlPackToReply("  ", base, pearl);
    expect(full).toMatch(/^Hi Jenn!\n\nThank you so much/);
    expect(full.endsWith("Dan, co-founder of DreamMe")).toBe(true);
  });
});

describe("isExpiredCode", () => {
  it("expires the day after the batch's expiration date", () => {
    expect(isExpiredCode({ expires_on: "2026-09-28" }, "2026-09-28")).toBe(false);
    expect(isExpiredCode({ expires_on: "2026-09-28" }, "2026-09-29")).toBe(true);
    expect(isExpiredCode({ expires_on: null }, "2030-01-01")).toBe(false);
  });
});
