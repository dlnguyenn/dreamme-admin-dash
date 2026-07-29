import { describe, expect, it } from "vitest";
import {
  cleanDraft,
  isDeniedSender,
  isFeedbackMirror,
  isInternalSender,
} from "@/lib/support/triage";
import { normalizeSubject } from "@/lib/support/ingest";
import {
  applyStripeStates,
  deriveSubscriptions,
  mergeConsumerSubscriptions,
  overrideStripeTotals,
  planFromPeriod,
} from "@/lib/support/resolve-user";
import { planFromStripeRecurring } from "@/lib/vendors/stripe";
import { applyActionToContext } from "@/lib/support/action-effects";
import type { SubscriptionInfo, UserContext } from "@/lib/support/types";
import { replySubject } from "@/lib/support/mailer";
import { resolveCounterpart } from "@/lib/support/imap";
import { htmlToPlainText, messageText } from "@/lib/support/email-text";
import { splitQuotedText } from "@/lib/support/email-text";

describe("htmlToPlainText / messageText", () => {
  // Jo N. 2026-07-28: Apple Mail HTML-only reply — no text/plain part at
  // all, so body_text was null and triage spam-binned a real cancel ask.
  const joHtml = `<html><head><meta http-equiv="content-type"></head><body dir="auto"><div>please cancel my subscription&nbsp;</div><div><br></div><div>Sent from my iPhone</div><div><br></div><blockquote>On Jul 28, 2026, at 1:48 PM, DreamMe &lt;billing@dreamme.life&gt; wrote:<br>﻿<div><h1>Your DreamMe free trial ends soon</h1><p>Hi there</p></div></blockquote></body></html>`;

  it("recovers the user's words from an HTML-only Apple Mail reply", () => {
    const text = htmlToPlainText(joHtml);
    expect(text).toMatch(/^please cancel my subscription/);
    expect(text).toMatch(/Sent from my iPhone/);
    expect(text).toContain("billing@dreamme.life");
    expect(text).not.toMatch(/<div|&nbsp;|﻿/);
  });

  it("messageText prefers plain text and falls back to HTML", () => {
    expect(messageText("real text", joHtml)).toBe("real text");
    expect(messageText("  ", joHtml)).toMatch(/^please cancel/);
    expect(messageText(null, null)).toBe("");
  });

  it("drops style/script blocks and collapses whitespace", () => {
    const text = htmlToPlainText(
      "<style>.a{color:red}</style><p>hello   world</p><script>x()</script>",
    );
    expect(text).toBe("hello world");
  });
});

describe("splitQuotedText", () => {
  it("splits a Gmail reply at the attribution line (Jennifer's real shape)", () => {
    const body = `I appreciate that you're working on it, but I just started on a glp-1 and I need to be tracking my foods. I'm requesting a refund.

Thank you,
Jennifer

On Sun, Jul 26, 2026 at 5:07 PM Dan N <dan@dreamme.life> wrote:

> Hi Jennifer,
>
> I'm so sorry you're running into this!`;
    const { main, quoted } = splitQuotedText(body);
    expect(main).toMatch(/requesting a refund/);
    expect(main).not.toMatch(/wrote:/);
    expect(quoted).toMatch(/^On Sun, Jul 26/);
    expect(quoted).toMatch(/Hi Jennifer/);
  });

  it("splits at a bare > block with no attribution", () => {
    const { main, quoted } = splitQuotedText("Sounds good!\n\n> earlier text\n> more");
    expect(main).toBe("Sounds good!");
    expect(quoted).toBe("> earlier text\n> more");
  });

  it("handles a wrapped attribution line", () => {
    const body = "Thanks so much\n\nOn Sat, Jul 25, 2026 at 9:00 AM Somebody With A Long Name\n<x@y.com> wrote:\n> hi";
    const { main, quoted } = splitQuotedText(body);
    expect(main).toBe("Thanks so much");
    expect(quoted).toMatch(/^On Sat/);
  });

  it("splits Outlook-style original-message blocks", () => {
    const body = "Please cancel.\n\n-----Original Message-----\nFrom: DreamMe\nSent: Friday";
    const { main, quoted } = splitQuotedText(body);
    expect(main).toBe("Please cancel.");
    expect(quoted).toMatch(/Original Message/);
  });

  it("leaves unquoted bodies and all-quote bodies whole", () => {
    expect(splitQuotedText("just a normal email")).toEqual({
      main: "just a normal email",
      quoted: null,
    });
    const allQuote = splitQuotedText("> only quoted\n> lines");
    expect(allQuote.main).toBe("> only quoted\n> lines");
    expect(allQuote.quoted).toBeNull();
  });
});

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

describe("plan derivation", () => {
  it("infers plan from the NORMAL period length", () => {
    const mk = (days: number) => ({
      period_type: "NORMAL",
      event_at: "2026-07-01T00:00:00Z",
      expiration_at: new Date(
        Date.parse("2026-07-01T00:00:00Z") + days * 86400_000,
      ).toISOString(),
    });
    expect(planFromPeriod(mk(365))).toBe("yearly");
    expect(planFromPeriod(mk(91))).toBe("quarterly");
    expect(planFromPeriod(mk(30))).toBe("monthly");
    expect(planFromPeriod(mk(7))).toBe("weekly");
  });

  it("refuses to infer from a trial window", () => {
    expect(
      planFromPeriod({
        period_type: "TRIAL",
        event_at: "2026-07-01T00:00:00Z",
        expiration_at: "2026-07-08T00:00:00Z",
      }),
    ).toBeNull();
  });

  it("maps Stripe recurring intervals", () => {
    expect(planFromStripeRecurring({ interval: "year" })).toBe("yearly");
    expect(planFromStripeRecurring({ interval: "month", interval_count: 3 })).toBe("quarterly");
    expect(planFromStripeRecurring({ interval: "month" })).toBe("monthly");
    expect(planFromStripeRecurring(null)).toBeNull();
  });
});

describe("mergeConsumerSubscriptions", () => {
  const sub = {
    store: "APP_STORE",
    productId: "sku_year",
    transactionId: "t1",
    originalTransactionId: "t1",
    periodType: "TRIAL",
    isTrial: true,
    lastEventType: "INITIAL_PURCHASE",
    lastEventAt: "2026-07-20T00:00:00Z",
    expiresAt: "2026-07-27T00:00:00Z",
    cancelReason: null,
    isActive: true,
    totalPaidUsd: 0,
    plan: null,
    startedAt: "2026-07-20T00:00:00Z",
    autoRenew: null,
    renewals: 0,
  };
  const row = {
    store: "app_store",
    product_id: "sku_year",
    plan: "yearly",
    status: "trial",
    is_trial: true,
    price: 69.99,
    currency: "USD",
    purchased_at: "2026-07-20T00:00:00Z",
    original_purchased_at: "2026-06-01T00:00:00Z",
    expires_at: "2026-07-27T00:00:00Z",
    auto_renew: false,
    total_spent: 0,
    total_renewals: 2,
  };

  it("overlays plan, start date, auto-renew, and renewal count", () => {
    const [m] = mergeConsumerSubscriptions([sub], [row]);
    expect(m.plan).toBe("yearly");
    expect(m.startedAt).toBe("2026-06-01T00:00:00Z");
    expect(m.autoRenew).toBe(false);
    expect(m.renewals).toBe(2);
  });

  it("matches store case-insensitively and consumes each row once", () => {
    const [a, b] = mergeConsumerSubscriptions(
      [sub, { ...sub, originalTransactionId: "t2", productId: null }],
      [row],
    );
    expect(a.plan).toBe("yearly");
    expect(b.plan).toBeNull(); // row already consumed
  });

  it("keeps the derived value when the sink says 'other'", () => {
    const [m] = mergeConsumerSubscriptions(
      [{ ...sub, plan: "monthly" }],
      [{ ...row, plan: "other" }],
    );
    expect(m.plan).toBe("monthly");
  });

  it("leaves subs untouched when no row matches", () => {
    const [m] = mergeConsumerSubscriptions([sub], [{ ...row, store: "stripe" }]);
    expect(m.plan).toBeNull();
    expect(m.autoRenew).toBeNull();
  });
});

describe("applyActionToContext", () => {
  const stripeSub: SubscriptionInfo = {
    store: "STRIPE",
    productId: null,
    transactionId: "si_1",
    originalTransactionId: "sub_abc",
    periodType: "NORMAL",
    isTrial: false,
    lastEventType: "INITIAL_PURCHASE",
    lastEventAt: "2026-07-17T00:00:00Z",
    expiresAt: "2027-07-17T00:00:00Z",
    cancelReason: null,
    isActive: true,
    totalPaidUsd: 69.99,
    plan: "yearly",
    startedAt: "2026-07-17T00:00:00Z",
    autoRenew: true,
    renewals: 0,
  };
  const ctx: UserContext = {
    appUserId: "u1",
    email: "x@y.com",
    name: null,
    journeyStage: null,
    subscriptions: [stripeSub],
    totalSpentUsd: 69.99,
    noAccount: false,
    sandboxOnly: false,
  };
  const at = "2026-07-27T20:00:00Z";

  it("cancel_now flips Active → closed immediately", () => {
    const out = applyActionToContext(ctx, {
      type: "stripe_cancel_now",
      subscriptionId: "sub_abc",
      at,
    })!;
    expect(out.subscriptions[0].isActive).toBe(false);
    expect(out.subscriptions[0].autoRenew).toBe(false);
    expect(out.subscriptions[0].expiresAt).toBe(at);
  });

  it("cancel_at_period_end keeps access but marks won't-renew", () => {
    const out = applyActionToContext(ctx, {
      type: "stripe_cancel_at_period_end",
      subscriptionId: "sub_abc",
      currentPeriodEnd: 1784678400,
      at,
    })!;
    expect(out.subscriptions[0].isActive).toBe(true);
    expect(out.subscriptions[0].autoRenew).toBe(false);
    expect(out.subscriptions[0].expiresAt).toBe(
      new Date(1784678400 * 1000).toISOString(),
    );
  });

  it("refund reduces the paid totals", () => {
    const out = applyActionToContext(ctx, {
      type: "stripe_refund",
      refundedCents: 6999,
      at,
    })!;
    expect(out.subscriptions[0].totalPaidUsd).toBe(0);
    expect(out.totalSpentUsd).toBe(0);
  });

  it("play refund+revoke closes the Google sub", () => {
    const play = { ...stripeSub, store: "PLAY_STORE" as const, originalTransactionId: "GPA.1" };
    const out = applyActionToContext(
      { ...ctx, subscriptions: [play] },
      { type: "rc_play_refund_revoke", at },
    )!;
    expect(out.subscriptions[0].isActive).toBe(false);
    expect(out.subscriptions[0].cancelReason).toBe("CUSTOMER_SUPPORT");
  });

  it("targets the exact sub_ match, falling back to first store match", () => {
    const two = {
      ...ctx,
      subscriptions: [
        { ...stripeSub, originalTransactionId: "sub_other" },
        { ...stripeSub, originalTransactionId: "sub_abc", totalPaidUsd: 10 },
      ],
    };
    const out = applyActionToContext(two, {
      type: "stripe_cancel_now",
      subscriptionId: "sub_abc",
      at,
    })!;
    expect(out.subscriptions[0].isActive).toBe(true); // untouched
    expect(out.subscriptions[1].isActive).toBe(false);
  });

  it("returns null when there is nothing to update", () => {
    expect(applyActionToContext(null, { type: "stripe_cancel_now", at })).toBeNull();
    expect(
      applyActionToContext(
        { ...ctx, subscriptions: [{ ...stripeSub, store: "APP_STORE" }] },
        { type: "stripe_cancel_now", at },
      ),
    ).toBeNull();
  });
});

describe("applyStripeStates", () => {
  const rcSub: SubscriptionInfo = {
    store: "STRIPE",
    productId: "prod_x",
    transactionId: "si_1",
    originalTransactionId: "si_1",
    periodType: "NORMAL",
    isTrial: false,
    lastEventType: "CANCELLATION",
    lastEventAt: "2026-07-25T00:00:00Z",
    expiresAt: "2027-07-25T00:00:00Z", // stale RC expiry
    cancelReason: "BILLING_ERROR",
    isActive: true, // RC never saw the cancel
    totalPaidUsd: 0,
    plan: "yearly",
    startedAt: "2026-07-17T00:00:00Z",
    autoRenew: false,
    renewals: 0,
  };

  it("closes a sub Stripe says is canceled even when RC missed it (Alyssa)", () => {
    const [out] = applyStripeStates(
      [rcSub],
      [
        {
          itemId: "si_1",
          status: "canceled",
          cancelAtPeriodEnd: false,
          currentPeriodEnd: 1785095047,
          endedAt: 1785179700,
        },
      ],
    );
    expect(out.isActive).toBe(false);
    expect(out.autoRenew).toBe(false);
    expect(out.expiresAt).toBe(new Date(1785179700 * 1000).toISOString());
    expect(out.lastEventType).toBe("stripe:canceled");
  });

  it("matches the lone stripe sub even when item ids differ", () => {
    const [out] = applyStripeStates(
      [{ ...rcSub, transactionId: "si_other" }],
      [{ itemId: "si_new", status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: 1785095047, endedAt: null }],
    );
    expect(out.isActive).toBe(true);
    expect(out.autoRenew).toBe(false); // cancel_at_period_end → won't renew
  });

  it("leaves non-Stripe subs and unmatched subs alone", () => {
    const apple = { ...rcSub, store: "APP_STORE" as const };
    const [out] = applyStripeStates(
      [apple],
      [{ itemId: "si_1", status: "canceled", cancelAtPeriodEnd: false, currentPeriodEnd: null, endedAt: null }],
    );
    expect(out.isActive).toBe(true);
  });
});

describe("overrideStripeTotals", () => {
  const base = {
    store: "STRIPE" as const,
    productId: null,
    transactionId: "si_1",
    originalTransactionId: "si_1",
    periodType: "NORMAL",
    isTrial: false,
    lastEventType: "CANCELLATION",
    lastEventAt: "2026-07-25T00:00:00Z",
    expiresAt: "2027-07-25T00:00:00Z",
    cancelReason: "BILLING_ERROR",
    isActive: true,
    totalPaidUsd: 0,
    plan: "yearly",
    startedAt: "2026-07-17T00:00:00Z",
    autoRenew: false,
    renewals: 0,
  };

  it("replaces the RC $0 with Stripe's collected total (Alyssa's case)", () => {
    const { subscriptions, totalSpentUsd } = overrideStripeTotals([base], 0, 69.99);
    expect(subscriptions[0].totalPaidUsd).toBe(69.99);
    expect(totalSpentUsd).toBe(69.99);
  });

  it("replaces rather than adds when RC already counted some Stripe money", () => {
    const { totalSpentUsd } = overrideStripeTotals(
      [{ ...base, totalPaidUsd: 69.99 }],
      99.98, // 69.99 stripe + 29.99 from an old Apple sub
      69.99,
    );
    expect(totalSpentUsd).toBeCloseTo(99.98);
  });

  it("reflects refunds (Stripe net lower than RC's sum)", () => {
    const { subscriptions, totalSpentUsd } = overrideStripeTotals(
      [{ ...base, totalPaidUsd: 69.99 }],
      69.99,
      0, // fully refunded in Stripe
    );
    expect(subscriptions[0].totalPaidUsd).toBe(0);
    expect(totalSpentUsd).toBe(0);
  });

  it("puts the customer total on one sub, never double counting", () => {
    const { subscriptions, totalSpentUsd } = overrideStripeTotals(
      [base, { ...base, transactionId: "si_2", originalTransactionId: "si_2" }],
      0,
      69.99,
    );
    expect(subscriptions.map((s) => s.totalPaidUsd)).toEqual([69.99, 0]);
    expect(totalSpentUsd).toBe(69.99);
  });

  it("leaves non-Stripe users untouched", () => {
    const apple = { ...base, store: "APP_STORE" as const, totalPaidUsd: 39.99 };
    const res = overrideStripeTotals([apple], 39.99, 0);
    expect(res.subscriptions[0].totalPaidUsd).toBe(39.99);
    expect(res.totalSpentUsd).toBe(39.99);
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
