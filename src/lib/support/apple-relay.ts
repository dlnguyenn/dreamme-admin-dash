/**
 * Support Inbox — Apple "Hide My Email" detection + the reply templates
 * that point users at Apple's refund flow.
 *
 * Apple refunds are Apple's alone: nothing on our side can issue them, so
 * every Apple refund ask ends at https://reportaproblem.apple.com. Two
 * shapes of user need that reply:
 *
 *  - CONFIRMED Apple: a @privaterelay.appleid.com sender, or a resolved
 *    APP_STORE subscription.
 *  - SUSPECTED: we could not match the sender to any account anywhere —
 *    not the consumer users table, not Stripe by email. Hide My Email is
 *    the usual cause (they subscribed with a relay address and write from
 *    their real one, or vice versa). The copy hedges accordingly, because
 *    an unmatched sender could still be an Android user.
 *
 * Pure — unit-tested.
 */
import type { UserContext } from "./types";

export type AppleRelayStatus = "confirmed" | "suspected" | "no";

const RELAY_DOMAIN = "@privaterelay.appleid.com";

export function isAppleRelayAddress(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith(RELAY_DOMAIN);
}

export function appleRelayStatus(
  email: string | null | undefined,
  ctx: UserContext | null | undefined,
): AppleRelayStatus {
  if (isAppleRelayAddress(email) || isAppleRelayAddress(ctx?.email)) {
    return "confirmed";
  }
  const subs = ctx?.subscriptions ?? [];
  if (subs.some((s) => s.store === "APP_STORE")) return "confirmed";
  // Resolved to a store we CAN act on — Apple copy would be wrong.
  if (subs.length > 0) return "no";
  // Nothing found anywhere (consumer users + Stripe email search both
  // missed): most often a hidden Apple email.
  if (!ctx || ctx.noAccount) return "suspected";
  return "no";
}

const SIGNOFF = "Dan, co-founder of DreamMe";

const APPLE_REFUND_STEPS = `1. Go to https://reportaproblem.apple.com and sign in with your Apple ID
2. Find DreamMe in the list of purchases
3. Choose "Request a refund", pick a reason, and submit`;

/** Confirmed Apple purchaser asking for a refund. */
export const APPLE_REFUND_TEMPLATE = `Hi there! Thanks so much for reaching out, and I'm sorry for the hassle.

Your subscription was purchased through Apple, which means Apple handles the refund and I genuinely can't push it through from my side. Here is the fastest path:

${APPLE_REFUND_STEPS}

Apple is usually quick about it, often within a day or two! If they turn it down for any reason, just reply here and I will see what else I can do.

Thanks for giving DreamMe a try, it really means a lot to our tiny team!

${SIGNOFF}`;

/**
 * Suspected Hide My Email: we found no account for the address they wrote
 * from. Give them the Apple path, but leave an obvious door open if they
 * actually subscribed on Android or the website, where we CAN act.
 */
export const APPLE_HIDDEN_EMAIL_TEMPLATE = `Hi there! Thanks so much for reaching out, and I'm sorry for the runaround.

I had a look and couldn't find a DreamMe account under this email address. That almost always means the subscription was set up with Apple's Hide My Email, so the account sits under a private relay address rather than the one you are writing from.

If you subscribed through the App Store, Apple handles refunds directly and I can't issue one from my side:

${APPLE_REFUND_STEPS}

And if you actually signed up on Android or through our website, just say the word and I will take care of the cancellation and refund myself, no Apple needed!

Thanks so much for bearing with me on this!

${SIGNOFF}`;

export function appleRefundTemplate(status: AppleRelayStatus): string {
  return status === "suspected"
    ? APPLE_HIDDEN_EMAIL_TEMPLATE
    : APPLE_REFUND_TEMPLATE;
}
