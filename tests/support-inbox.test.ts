import { describe, expect, it } from "vitest";
import {
  cleanDraft,
  isDeniedSender,
  isFeedbackMirror,
  isInternalSender,
} from "@/lib/support/triage";
import { normalizeSubject } from "@/lib/support/ingest";
import { deriveSubscriptions } from "@/lib/support/resolve-user";
import { replySubject } from "@/lib/support/mailer";
import { resolveCounterpart } from "@/lib/support/imap";

describe("resolveCounterpart (Google Group DMARC rewrite)", () => {
  it("recovers the real sender from Reply-To on group-rewritten mail", () => {
    // Real shape: Angela Pittman via the help@ Google Group, 2026-07-26
    const r = resolveCounterpart({
      fromEmail: "help@dreamme.life",
      fromName: "'angela pittman' via Dreamme Help",
      replyToEmail: "angelajoel2015@yahoo.com",
      replyToName: "angela pittman",
      xOriginalSender: "angelajoel2015@yahoo.com",
    });
    expect(r.email).toBe("angelajoel2015@yahoo.com");
    expect(r.name).toBe("angela pittman");
  });

  it("falls back to X-Original-Sender and strips the 'via' wrapper", () => {
    const r = resolveCounterpart({
      fromEmail: "feedback@dreamme.life",
      fromName: "'Jane Doe' via DreamMe Feedback",
      replyToEmail: null,
      replyToName: null,
      xOriginalSender: "jane@example.com",
    });
    expect(r.email).toBe("jane@example.com");
    expect(r.name).toBe("Jane Doe");
  });

  it("leaves normal external senders untouched", () => {
    const r = resolveCounterpart({
      fromEmail: "user@gmail.com",
      fromName: "User",
      replyToEmail: "elsewhere@spam.com",
      replyToName: null,
      xOriginalSender: null,
    });
    expect(r.email).toBe("user@gmail.com");
  });

  it("keeps the alias when no real address is recoverable", () => {
    const r = resolveCounterpart({
      fromEmail: "help@dreamme.life",
      fromName: "Dreamme Help",
      replyToEmail: "help@dreamme.life",
      replyToName: null,
      xOriginalSender: null,
    });
    expect(r.email).toBe("help@dreamme.life");
  });
});

describe("isFeedbackMirror", () => {
  it("flags notifier originals by raw From + subject", () => {
    expect(
      isFeedbackMirror("feedback@dreamme.life", "[Bug Report] New feedback from Monica"),
    ).toBe(true);
  });

  it("does not flag user replies on a mirror thread", () => {
    expect(
      isFeedbackMirror(
        "kpj5psbddn@privaterelay.appleid.com",
        "Re: [Bug Report] New feedback from Stephanie",
      ),
    ).toBe(false);
    // even if the reply arrives group-rewritten with raw From = feedback@
    expect(
      isFeedbackMirror("feedback@dreamme.life", "Re: [Bug Report] New feedback from Stephanie"),
    ).toBe(false);
  });

  it("does not flag direct user mail to the feedback@ group", () => {
    expect(isFeedbackMirror("feedback@dreamme.life", "app keeps crashing")).toBe(false);
  });
});

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
