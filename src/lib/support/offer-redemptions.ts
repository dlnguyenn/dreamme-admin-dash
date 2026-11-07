/**
 * Support Inbox — was a handed-out Yearly Special code redeemed?
 *
 * RevenueCat never sees the code itself. A redemption arrives as an rc_events
 * row whose `offer_code` is the App Store Connect offer NAME, shared by every
 * code in every batch. So a code can only be tied to a redemption two ways:
 *  - "redeemed": the thread is linked to an app account, and that account
 *    shows a redemption after the code was handed out.
 *  - "likely": a redemption arrived after the code was handed out, on an
 *    account we can't tie to a thread, and this was the only code out at the
 *    time that could explain it.
 *  - "possible": same, but several codes were out, so it could be any of them.
 * No entry means no redemption has reached RevenueCat since the code went out.
 * Someone who never paid for DreamMe on their Apple ID may not show up until
 * they open the app and RevenueCat syncs the receipt.
 *
 * Pure — unit-tested. Keep free of server-only imports (the client uses it).
 */
import { isExpiredCode, type OfferCodeRow } from "./offer-codes";

/** The ASC offer behind the "Yearly Special" one-time codes, as RevenueCat reports it. */
export const YEARLY_SPECIAL_ASC_OFFER = "DreamMe Life Yearly Special (Discounted) - $40";

export interface OfferRedemptionEvent {
  app_user_id: string;
  event_at: string;
}

export type RedemptionStatus = "redeemed" | "likely" | "possible";

export interface OfferRedemption {
  status: RedemptionStatus;
  /** when RevenueCat saw the redemption */
  at: string;
  /** codes that could explain this redemption (1 unless "possible") */
  candidates: number;
}

/** "14 min", "3 hr", "2 days" */
function gap(fromIso: string, toIso: string): string {
  const m = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hr`;
  return `${Math.round(h / 24)} days`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface RedemptionCopy {
  tone: "success" | "warning" | "neutral";
  /** short tag for the codes list */
  tag: string;
  /** bold lead-in on the thread */
  headline: string;
  /** what backs it up */
  detail: string;
}

/**
 * What to say about one handed-out code. `r` undefined means no redemption
 * matched it.
 */
export function describeRedemption(
  r: OfferRedemption | undefined,
  handedOutAt: string | null,
): RedemptionCopy {
  if (!r) {
    return {
      tone: "neutral",
      tag: "NOT REDEEMED YET",
      headline: "Not redeemed yet.",
      detail:
        "No Yearly Special code redemption has reached RevenueCat since this code went out. " +
        "Someone new to DreamMe may not show up until they open the app.",
    };
  }
  const after = handedOutAt ? `, ${gap(handedOutAt, r.at)} after this code went out` : "";
  if (r.status === "redeemed") {
    return {
      tone: "success",
      tag: "REDEEMED",
      headline: `Redeemed ${when(r.at)}${after}.`,
      detail: "RevenueCat shows the Yearly Special on this customer's account.",
    };
  }
  if (r.status === "likely") {
    return {
      tone: "success",
      tag: "LIKELY REDEEMED",
      headline: `Likely redeemed ${when(r.at)}${after}.`,
      detail:
        "RevenueCat logged a Yearly Special code redemption then, and no other code out at the time could explain it. " +
        "It can't be tied to this customer for sure because the thread isn't linked to their app account.",
    };
  }
  return {
    tone: "warning",
    tag: "POSSIBLY REDEEMED",
    headline: "Possibly redeemed.",
    detail: `A Yearly Special code redemption came in ${when(r.at)}, but ${r.candidates} codes were out then, so it could be any of them.`,
  };
}

/** A handout logged a little after the customer acted (Gmail send, then
 *  "Mark used") must still count, so allow some slack before used_at. */
const SLACK_MS = 10 * 60 * 1000;

type CodeLike = Pick<OfferCodeRow, "code" | "used_at" | "thread_id" | "expires_on">;

/**
 * Match redemption events to handed-out codes.
 * `linkedUserByThread` maps a thread id to the app account it is linked to.
 */
export function matchOfferRedemptions(
  codes: CodeLike[],
  events: OfferRedemptionEvent[],
  linkedUserByThread: Record<string, string | null | undefined>,
): Record<string, OfferRedemption> {
  const out: Record<string, OfferRedemption> = {};
  const handedOut = codes.filter((c) => !!c.used_at);
  const t = (iso: string) => new Date(iso).getTime();
  const linkedUser = (c: CodeLike) => (c.thread_id ? linkedUserByThread[c.thread_id] ?? null : null);

  // One redemption per account: its first offer event (a redemption can also
  // log a PRODUCT_CHANGE or later renewals under the same offer).
  const firstByUser = new Map<string, OfferRedemptionEvent>();
  for (const e of [...events].sort((a, b) => t(a.event_at) - t(b.event_at))) {
    if (!firstByUser.has(e.app_user_id)) firstByUser.set(e.app_user_id, e);
  }
  const pool = [...firstByUser.values()];

  // 1) Certain: the thread's own account redeemed after the handout.
  const used = new Set<string>();
  for (const c of handedOut) {
    const user = linkedUser(c);
    if (!user) continue;
    const e = firstByUser.get(user);
    if (e && t(e.event_at) >= t(c.used_at!) - SLACK_MS) {
      out[c.code] = { status: "redeemed", at: e.event_at, candidates: 1 };
      used.add(user);
    }
  }

  // 2) Inferred from timing, oldest redemption first.
  for (const e of pool) {
    if (used.has(e.app_user_id)) continue;
    const day = e.event_at.slice(0, 10);
    const candidates = handedOut.filter((c) => {
      if (out[c.code]?.status === "redeemed" || out[c.code]?.status === "likely") return false;
      if (t(c.used_at!) - SLACK_MS > t(e.event_at)) return false;
      // An expired code can't have produced it.
      if (isExpiredCode(c, day)) return false;
      // A thread linked to a different account would have redeemed on that one.
      const user = linkedUser(c);
      return !user || user === e.app_user_id;
    });
    if (candidates.length === 1) {
      out[candidates[0].code] = { status: "likely", at: e.event_at, candidates: 1 };
    } else {
      for (const c of candidates) {
        if (!out[c.code]) out[c.code] = { status: "possible", at: e.event_at, candidates: candidates.length };
      }
    }
  }
  return out;
}
