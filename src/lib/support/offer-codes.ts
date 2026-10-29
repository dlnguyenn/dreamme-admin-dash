/**
 * Support Inbox — one-time App Store offer codes. Two offers share one
 * table, told apart by offer_name:
 *  - Yearly Special ($39.99/yr) for iPhone users who ask for a discount.
 *  - Pearl Pack (550 pearls, com.dreamme.pearls.550) as a thank-you for
 *    feedback, added to whatever reply Dan is writing.
 *
 * Two questions decide whether a thread gets the "Send a Yearly Special
 * code" card:
 *  - did they ask for a discount? Triage sets `discount_request`; threads
 *    triaged before that flag existed fall back to a keyword scan of what
 *    the customer wrote.
 *  - are they on iPhone? Codes only redeem in the App Store, so a Google
 *    Play or web subscriber would get a link that does nothing for them.
 *
 * The Yearly Special is its own subscription group ("DreamMe Special"), so
 * a current Monthly/Quarterly/Yearly subscriber who redeems one WITHOUT
 * cancelling is billed for both. The reply template says so whenever the
 * person is, or might be, subscribed already.
 *
 * Pure — unit-tested. Keep free of server-only imports (the client uses it).
 */
import { isAppleRelayAddress } from "./apple-relay";
import { messageText } from "./email-text";
import type { SupportMessageRow, SupportThreadRow, UserContext } from "./types";

export const YEARLY_SPECIAL = "Yearly Special";
export const YEARLY_SPECIAL_PRICE = "$39.99";
export const PEARL_PACK = "Pearl Pack";
export const PEARL_PACK_PEARLS = 550;

export type OfferName = typeof YEARLY_SPECIAL | typeof PEARL_PACK;
export const OFFER_NAMES: OfferName[] = [YEARLY_SPECIAL, PEARL_PACK];

export function isOfferName(v: unknown): v is OfferName {
  return OFFER_NAMES.includes(v as OfferName);
}

/**
 * As of 2026-10-30 the app credits pearls only inside its own buy button
 * (PearlPackModal -> earnPearls after purchasePackage). A pack redeemed
 * from an App Store code is a real transaction that nothing turns into
 * pearls, so the card warns before inserting one. Flip to true once the app
 * (or the rc-webhook) credits redeemed packs.
 */
export const PEARL_CODES_CREDIT_PEARLS = false;

export interface OfferCodeRow {
  code: string;
  redeem_url: string;
  offer_name: string;
  batch: string | null;
  position: number;
  used_at: string | null;
  thread_id: string | null;
  used_by_email: string | null;
  used_by_name: string | null;
  note: string | null;
  created_at: string;
}

export interface OfferCodeCounts {
  total: number;
  used: number;
  free: number;
}

type MessageLike = Pick<SupportMessageRow, "direction" | "body_text" | "body_html">;

/** What the customer wrote, with our quoted replies cut off. */
function inboundText(messages: MessageLike[]): string {
  return messages
    .filter((m) => m.direction === "inbound")
    .map((m) => {
      const text = messageText(m.body_text, m.body_html) ?? "";
      // Drop the "On <date>, Dan wrote:" chain: our own offer must not
      // count as the customer asking.
      const cut = text.search(/^\s*(On .{4,120}wrote:|>)/m);
      return cut >= 0 ? text.slice(0, cut) : text;
    })
    .join("\n");
}

const DISCOUNT_RE =
  /\b(discount|promo(tion(al)?)?( code)?|coupon|offer code|loyalty|retention offer|cheaper|more affordable|afford|too expensive|getting expensive|becoming expensive|lower (the )?price|reduced price|special (price|pricing|offer|deal)|any deals?)\b/i;

export function askedForDiscount(
  thread: Pick<SupportThreadRow, "triage">,
  messages: MessageLike[],
): boolean {
  if (thread.triage?.is_spam) return false;
  if (thread.triage?.discount_request === true) return true;
  return DISCOUNT_RE.test(inboundText(messages));
}

export type IphoneSignal =
  | { ios: "yes"; reason: string }
  | { ios: "no"; reason: string }
  | { ios: "unknown"; reason: string };

/**
 * Best evidence for "downloaded DreamMe on an iPhone". A resolved store wins
 * over everything else; the mail-client signature is the fallback that
 * covers non-subscribers and senders we could not match to an account.
 */
export function iphoneSignal(
  thread: Pick<SupportThreadRow, "counterpart_email" | "resolved_store" | "user_context">,
  messages: MessageLike[],
): IphoneSignal {
  const subs = thread.user_context?.subscriptions ?? [];
  if (thread.resolved_store === "APP_STORE" || subs.some((s) => s.store === "APP_STORE")) {
    return { ios: "yes", reason: "App Store subscription" };
  }
  if (isAppleRelayAddress(thread.counterpart_email) || isAppleRelayAddress(thread.user_context?.email)) {
    return { ios: "yes", reason: "Apple Hide My Email address" };
  }
  if (thread.resolved_store === "PLAY_STORE" || subs.some((s) => s.store === "PLAY_STORE")) {
    return { ios: "no", reason: "Google Play subscriber" };
  }
  if (thread.resolved_store === "STRIPE" || subs.some((s) => s.store === "STRIPE")) {
    return { ios: "no", reason: "web (Stripe) subscriber" };
  }
  if (/Sent from my iP(hone|ad)/i.test(inboundText(messages))) {
    return { ios: "yes", reason: '"Sent from my iPhone"' };
  }
  return { ios: "unknown", reason: "no store or device on record" };
}

/** "yes" = has a live sub, "maybe" = we can't tell, "no" = nothing live. */
function subscribedNow(ctx: UserContext | null): "yes" | "maybe" | "no" {
  if (!ctx || ctx.noAccount) return "maybe";
  return ctx.subscriptions.some((s) => s.isActive && s.autoRenew !== false) ? "yes" : "no";
}

function firstName(
  thread: Pick<SupportThreadRow, "counterpart_name" | "user_context">,
  messages: MessageLike[],
): string | null {
  // The name Dan already greeted them with wins: "Jenn McQuaid" on the
  // header signs her mail "Jennifer", and the reply should match his.
  for (const m of [...messages].reverse()) {
    if (m.direction !== "outbound") continue;
    const hi = /^\s*Hi ([A-Z][A-Za-z'-]+)[!,]/.exec(messageText(m.body_text, m.body_html) ?? "");
    if (hi && hi[1] !== "there") return hi[1];
  }
  const raw = thread.user_context?.name || thread.counterpart_name || "";
  const first = raw.trim().split(/\s+/)[0] ?? "";
  // Skip handles and placeholders ("joejenmc", "K.") that read oddly.
  return /^[A-Za-z][A-Za-z'-]{1,}$/.test(first) ? first[0].toUpperCase() + first.slice(1) : null;
}

const SIGNOFF = "Dan, co-founder of DreamMe";

function redeemSteps(code: Pick<OfferCodeRow, "code">): string {
  return `Just open that link on your iPhone and Apple will walk you through it. You can also open the App Store, tap your profile picture, then "Redeem Gift Card or Code", and enter ${code.code}.`;
}

const CANCEL_STEPS =
  "Settings on your iPhone > tap your name > Subscriptions > DreamMe > Cancel Subscription";

/**
 * The reply that hands over one code. Dan's support voice: "Hi <Name>!",
 * warm, short, no em dashes, signed "Dan, co-founder of DreamMe".
 */
export function offerCodeReply(
  thread: Pick<SupportThreadRow, "counterpart_name" | "user_context">,
  code: Pick<OfferCodeRow, "code" | "redeem_url">,
  messages: MessageLike[] = [],
): string {
  const name = firstName(thread, messages);
  const subscribed = subscribedNow(thread.user_context);
  const cancelLine =
    subscribed === "yes"
      ? `One important step first: please cancel your current subscription (${CANCEL_STEPS}) so you don't get billed for both! You keep access until it runs out, and the yearly plan starts as soon as you redeem.`
      : subscribed === "maybe"
        ? `One important step first: if you have a monthly or quarterly subscription right now, please cancel it (${CANCEL_STEPS}) so you don't get billed for both! The yearly plan starts as soon as you redeem.`
        : null;
  return [
    `Hi ${name ?? "there"}!`,
    `Here's your Yearly Special code, it gets you a full year of DreamMe for just ${YEARLY_SPECIAL_PRICE}:`,
    code.redeem_url,
    redeemSteps(code),
    cancelLine,
    `Thanks so much for sticking with DreamMe, it genuinely means the world to us!`,
    SIGNOFF,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Add a Pearl Pack thank-you to the reply Dan is already writing (his own
 * text or an AI draft), just above the sign-off. With nothing written yet it
 * returns a short standalone thank-you. Running it twice with the same code
 * changes nothing.
 */
export function addPearlPackToReply(
  base: string,
  thread: Pick<SupportThreadRow, "counterpart_name" | "user_context">,
  code: Pick<OfferCodeRow, "code" | "redeem_url">,
  messages: MessageLike[] = [],
): string {
  if (base.includes(code.redeem_url)) return base;
  const gift = [
    `As a little thank you for your feedback, here's a free bag of ${PEARL_PACK_PEARLS} pearls to spend in the shop:`,
    code.redeem_url,
    redeemSteps(code),
  ].join("\n\n");

  const text = base.trim();
  if (!text) {
    const name = firstName(thread, messages);
    return [
      `Hi ${name ?? "there"}!`,
      `Thank you so much for taking the time to share your feedback, it genuinely helps us make DreamMe better!`,
      gift,
      SIGNOFF,
    ].join("\n\n");
  }
  const at = text.lastIndexOf(SIGNOFF);
  if (at < 0) return `${text}\n\n${gift}`;
  const before = text.slice(0, at).trimEnd();
  return `${before}\n\n${gift}\n\n${text.slice(at)}`;
}
