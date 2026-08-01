/**
 * Support Inbox — resolve an email address to a DreamMe account and its live
 * subscription state.
 *
 * Chain: email → consumer public.users (id == RC app_user_id) → internal
 * rc_events (webhook-fed, reliable) grouped by original_transaction_id →
 * RC v2 API subscriptions as fallback when no production events exist.
 */
import { spGet } from "./db";
import {
  fetchConsumerSubscriptions,
  findUserByEmail,
  userDisplayName,
  getAuthInfo,
  getUserById,
  type ConsumerSubscriptionRow,
} from "./consumer-db";
import {
  getCustomerSubscriptions,
  revenueCatConfigured,
} from "@/lib/vendors/revenuecat";
import {
  findCustomersByEmail,
  getSubscription,
  listSubscriptionsForCustomer,
  planFromStripeRecurring,
  resolveSubscriptionFromItem,
  stripeConfigured,
  sumPaidForCustomer,
} from "@/lib/vendors/stripe";
import type { Store, SubscriptionInfo, UserContext } from "./types";

interface RcEventLite {
  type: string;
  event_at: string;
  store: string | null;
  environment: string | null;
  product_id: string | null;
  period_type: string | null;
  transaction_id: string | null;
  original_transaction_id: string | null;
  price_usd: number | null;
  cancel_reason: string | null;
  expiration_at: string | null;
}

const PAYMENT_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "NON_RENEWING_PURCHASE",
]);

/**
 * Infer the billing plan from the current period length (expiration minus
 * event time). Only meaningful for NORMAL periods — a trial's 3–7 day
 * window says nothing about the plan it converts into. Exported for tests.
 */
export function planFromPeriod(e: {
  period_type: string | null;
  event_at: string;
  expiration_at: string | null;
}): string | null {
  if (e.period_type !== "NORMAL" || !e.expiration_at) return null;
  const days =
    (new Date(e.expiration_at).getTime() - new Date(e.event_at).getTime()) /
    86400_000;
  if (days > 200) return "yearly";
  if (days > 60) return "quarterly";
  if (days > 21) return "monthly";
  if (days > 4) return "weekly";
  return null;
}

/**
 * Overlay the consumer subscriptions sink (authoritative plan / trial /
 * renewal counts, fed by the RC webhook) onto rc_events-derived groups.
 * Matched per store, consuming each consumer row at most once. Pure —
 * exported for tests.
 */
export function mergeConsumerSubscriptions(
  subs: SubscriptionInfo[],
  rows: ConsumerSubscriptionRow[],
): SubscriptionInfo[] {
  const pool = [...rows];
  return subs.map((s) => {
    const idx = pool.findIndex(
      (r) =>
        (r.store ?? "").toUpperCase() === String(s.store).toUpperCase() &&
        (!r.product_id || !s.productId || r.product_id === s.productId),
    );
    if (idx === -1) return s;
    const [row] = pool.splice(idx, 1);
    return {
      ...s,
      plan: row.plan && row.plan !== "other" ? row.plan : s.plan,
      isTrial: row.is_trial ?? s.isTrial,
      startedAt: row.original_purchased_at ?? s.startedAt,
      autoRenew: row.auto_renew,
      renewals: row.total_renewals ?? s.renewals,
    };
  });
}

export const EMPTY_CONTEXT: UserContext = {
  appUserId: null,
  email: null,
  name: null,
  journeyStage: null,
  subscriptions: [],
  totalSpentUsd: 0,
  noAccount: true,
  sandboxOnly: false,
};

/**
 * Pure derivation from rc_events rows (newest-first NOT required; sorted
 * internally). Exported for unit tests.
 */
export function deriveSubscriptions(events: RcEventLite[]): {
  subscriptions: SubscriptionInfo[];
  totalSpentUsd: number;
  sandboxOnly: boolean;
} {
  const prod = events.filter((e) => e.environment === "PRODUCTION");
  const sandboxOnly = prod.length === 0 && events.length > 0;
  const groups = new Map<string, RcEventLite[]>();
  for (const e of prod) {
    const key = e.original_transaction_id ?? e.transaction_id ?? e.product_id ?? "?";
    const arr = groups.get(key);
    if (arr) arr.push(e);
    else groups.set(key, [e]);
  }

  let totalSpentUsd = 0;
  const subscriptions: SubscriptionInfo[] = [];
  const now = Date.now();

  for (const [key, group] of groups) {
    group.sort(
      (a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime(),
    );
    const latest = group[group.length - 1];
    let paid = 0;
    for (const e of group) {
      if (PAYMENT_TYPES.has(e.type)) paid += Number(e.price_usd) || 0;
      // Refund posted by support shows as CANCELLATION w/ CUSTOMER_SUPPORT
      if (e.type === "CANCELLATION" && e.cancel_reason === "CUSTOMER_SUPPORT") {
        paid -= Number(e.price_usd) || 0;
      }
    }
    totalSpentUsd += paid;
    const expiresAt = latest.expiration_at;
    subscriptions.push({
      store: (latest.store ?? "?") as Store,
      productId: latest.product_id,
      transactionId: latest.transaction_id,
      originalTransactionId: latest.original_transaction_id ?? key,
      periodType: latest.period_type,
      isTrial: latest.period_type === "TRIAL",
      lastEventType: latest.type,
      lastEventAt: latest.event_at,
      expiresAt,
      cancelReason: latest.cancel_reason,
      isActive: !!expiresAt && new Date(expiresAt).getTime() > now,
      totalPaidUsd: Math.max(0, paid),
      plan: planFromPeriod(latest),
      startedAt: group[0]?.event_at ?? null,
      autoRenew: null,
      renewals: group.filter((e) => e.type === "RENEWAL").length,
    });
  }

  // Most-recent activity first
  subscriptions.sort(
    (a, b) =>
      new Date(b.lastEventAt).getTime() - new Date(a.lastEventAt).getTime(),
  );
  return { subscriptions, totalSpentUsd: Math.max(0, totalSpentUsd), sandboxOnly };
}

async function fetchRcEvents(appUserId: string): Promise<RcEventLite[]> {
  return spGet<RcEventLite[]>(
    `rc_events?or=(app_user_id.eq.${encodeURIComponent(appUserId)},original_app_user_id.eq.${encodeURIComponent(appUserId)})` +
      `&select=type,event_at,store,environment,product_id,period_type,transaction_id,original_transaction_id,price_usd,cancel_reason,expiration_at` +
      `&order=event_at.desc&limit=200`,
  );
}

/** RC v2 store names → webhook-style store names used everywhere else. */
function normalizeStore(v2store: string): string {
  const map: Record<string, string> = {
    app_store: "APP_STORE",
    play_store: "PLAY_STORE",
    stripe: "STRIPE",
    rc_billing: "RC_BILLING",
    amazon: "AMAZON",
  };
  return map[v2store] ?? v2store.toUpperCase();
}

/**
 * Replace the RC-derived spend on STRIPE subscriptions with the total
 * actually collected per Stripe's charge ledger. RC's webhook stream can
 * miss money entirely: a first charge attempt that fails emits
 * BILLING_ISSUE + CANCELLATION(BILLING_ERROR), and when Stripe's smart
 * retry later collects the payment RC sends nothing priced — so an
 * events-derived total says $0.00 for a user Stripe charged $69.99
 * (seen live 2026-07-27, douglasa87@). Pure arithmetic — exported for
 * tests; the Stripe I/O lives in enrichStripeTotals below.
 */
export function overrideStripeTotals(
  subscriptions: SubscriptionInfo[],
  totalSpentUsd: number,
  stripePaidUsd: number,
): { subscriptions: SubscriptionInfo[]; totalSpentUsd: number } {
  const stripeSubs = subscriptions.filter((s) => s.store === "STRIPE");
  if (stripeSubs.length === 0) return { subscriptions, totalSpentUsd };
  const rcStripeSum = stripeSubs.reduce((a, s) => a + s.totalPaidUsd, 0);
  let assigned = false;
  const out = subscriptions.map((s) => {
    if (s.store !== "STRIPE") return s;
    // Charges aren't split per subscription; put the customer total on the
    // first (most recent) Stripe sub and zero the rest so nothing double
    // counts. Users with several Stripe subs are vanishingly rare.
    const mine = assigned ? 0 : stripePaidUsd;
    assigned = true;
    return { ...s, totalPaidUsd: mine };
  });
  return {
    subscriptions: out,
    totalSpentUsd: Math.max(0, totalSpentUsd - rcStripeSum + stripePaidUsd),
  };
}

export interface StripeSubState {
  /** si_… item id the state belongs to (matches SubscriptionInfo.transactionId) */
  itemId: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number | null;
  endedAt: number | null;
}

/**
 * Override RC-derived STRIPE subscription state with Stripe's own: RC's
 * Stripe sync can miss both money AND lifecycle (a dash-cancelled sub kept
 * showing 2027 expiry because RC never emitted the cancellation). Pure —
 * exported for tests.
 */
export function applyStripeStates(
  subs: SubscriptionInfo[],
  states: StripeSubState[],
): SubscriptionInfo[] {
  if (!states.length) return subs;
  const stripeCount = subs.filter((s) => s.store === "STRIPE").length;
  return subs.map((s) => {
    if (s.store !== "STRIPE") return s;
    const st =
      states.find((x) => x.itemId && x.itemId === s.transactionId) ??
      // unambiguous when there's exactly one of each
      (stripeCount === 1 && states.length === 1 ? states[0] : undefined);
    if (!st) return s;
    const givesAccess = ["trialing", "active", "past_due"].includes(st.status);
    const endUnix = st.endedAt ?? st.currentPeriodEnd;
    return {
      ...s,
      isActive: givesAccess,
      isTrial: st.status === "trialing",
      autoRenew: givesAccess ? !st.cancelAtPeriodEnd : false,
      expiresAt: endUnix ? new Date(endUnix * 1000).toISOString() : s.expiresAt,
      lastEventType: `stripe:${st.status}`,
    };
  });
}

/**
 * The Stripe truth behind STRIPE subscriptions (via the si_… item id from
 * rc_events, falling back to email search): the refund-netted paid total
 * for the customer(s), plus each subscription's live state. Null when
 * nothing could be resolved — callers keep the RC-derived numbers.
 */
async function fetchStripeTruth(
  subs: SubscriptionInfo[],
  email: string | null,
): Promise<{ paidUsd: number; states: StripeSubState[] } | null> {
  if (!stripeConfigured()) return null;
  if (!subs.some((s) => s.store === "STRIPE")) return null;
  try {
    const customers = new Set<string>();
    const states: StripeSubState[] = [];
    const noteSub = (sub: {
      status: string;
      cancel_at_period_end: boolean;
      current_period_end: number;
      ended_at?: number | null;
      customer: string;
      items?: { data?: Array<{ id: string }> };
    }) => {
      customers.add(sub.customer);
      states.push({
        itemId: sub.items?.data?.[0]?.id ?? null,
        status: sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        currentPeriodEnd: sub.current_period_end || null,
        endedAt: sub.ended_at ?? null,
      });
    };

    for (const s of subs) {
      if (s.store !== "STRIPE" || !s.transactionId?.startsWith("si_")) continue;
      const subId = await resolveSubscriptionFromItem(s.transactionId);
      if (!subId) continue;
      const sub = await getSubscription(subId).catch(() => null);
      if (sub?.customer) noteSub(sub);
    }
    if (customers.size === 0 && email) {
      for (const c of await findCustomersByEmail(email)) {
        for (const sub of await listSubscriptionsForCustomer(c.id)) {
          noteSub(sub);
        }
      }
    }
    if (customers.size === 0) return null;
    let cents = 0;
    for (const id of customers) cents += await sumPaidForCustomer(id);
    return { paidUsd: cents / 100, states };
  } catch {
    return null;
  }
}

/**
 * Fallback for senders with no consumer-users match: search Stripe by the
 * email address. Web-checkout subscribers often write from their billing
 * email while their app account uses another (or an Apple relay), so the
 * DreamMe lookup misses even though Stripe knows exactly who they are.
 * A hit still reports noAccount (there really is no matched app account)
 * but carries the Stripe subscription(s), which lights up the cancel/
 * refund buttons in the sidebar.
 */
async function stripeFallback(email: string): Promise<UserContext | null> {
  if (!stripeConfigured()) return null;
  try {
    const customers = await findCustomersByEmail(email);
    return contextFromStripeCustomers(
      customers.map((c) => c.id),
      email,
    );
  } catch {
    return null;
  }
}

/**
 * Build a UserContext from Stripe customer ids alone. Shared by the
 * email fallback and by manual linking ("Maybe this user?"), so both
 * paths produce an identical shape and the action buttons behave the
 * same. Returns null when none of the customers has a subscription.
 */
export async function contextFromStripeCustomers(
  customerIds: string[],
  emailLabel: string | null,
  opts: { name?: string | null; linkedCustomerId?: string | null } = {},
): Promise<UserContext | null> {
  if (!stripeConfigured() || customerIds.length === 0) return null;
  try {
    const subscriptions: SubscriptionInfo[] = [];
    let totalSpentUsd = 0;
    for (const customerId of customerIds) {
      const subs = await listSubscriptionsForCustomer(customerId);
      if (!subs.length) continue;
      totalSpentUsd += (await sumPaidForCustomer(customerId)) / 100;
      for (const s of subs) {
        subscriptions.push({
          store: "STRIPE" as Store,
          productId: null,
          transactionId: s.items?.data?.[0]?.id ?? null, // si_… item id
          originalTransactionId: s.id, // sub_…
          periodType: s.status === "trialing" ? "TRIAL" : "NORMAL",
          isTrial: s.status === "trialing",
          lastEventType: `stripe:${s.status}`,
          lastEventAt: new Date().toISOString(),
          expiresAt: s.current_period_end
            ? new Date(s.current_period_end * 1000).toISOString()
            : null,
          cancelReason: null,
          isActive: s.status === "trialing" || s.status === "active",
          totalPaidUsd: 0, // per-sub split unknown; customer total below
          plan: planFromStripeRecurring(s.items?.data?.[0]?.price?.recurring),
          startedAt: s.start_date
            ? new Date(s.start_date * 1000).toISOString()
            : null,
          autoRenew: s.status === "canceled" ? false : !s.cancel_at_period_end,
          renewals: null,
        });
      }
    }
    if (!subscriptions.length) return null;
    if (subscriptions.length === 1) {
      subscriptions[0].totalPaidUsd = totalSpentUsd;
    }
    return {
      appUserId: null,
      email: emailLabel?.toLowerCase() ?? null,
      name: opts.name ?? null,
      journeyStage: null,
      subscriptions,
      totalSpentUsd,
      // Still no matched app account — the sidebar keeps saying so, but
      // now with the Stripe subscription attached.
      noAccount: true,
      sandboxOnly: false,
      linkedStripeCustomerId: opts.linkedCustomerId ?? null,
    };
  } catch {
    return null;
  }
}

export async function resolveUser(
  email: string | null,
  knownUserId?: string | null,
): Promise<UserContext> {
  const user = knownUserId
    ? await getUserById(knownUserId).catch(() => null)
    : email
      ? await findUserByEmail(email).catch(() => null)
      : null;
  if (!user) {
    if (email) {
      const viaStripe = await stripeFallback(email);
      if (viaStripe) return viaStripe;
    }
    return { ...EMPTY_CONTEXT, email: email?.toLowerCase() ?? null };
  }

  const [events, consumerRows, authInfo] = await Promise.all([
    fetchRcEvents(user.id).catch(() => [] as RcEventLite[]),
    fetchConsumerSubscriptions(user.id).catch(
      () => [] as ConsumerSubscriptionRow[],
    ),
    getAuthInfo(user.id),
  ]);
  let derived = deriveSubscriptions(events);
  derived = {
    ...derived,
    subscriptions: mergeConsumerSubscriptions(
      derived.subscriptions,
      consumerRows,
    ),
  };

  // Fallback: no production webhook events → ask RC v2 directly.
  if (derived.subscriptions.length === 0 && revenueCatConfigured()) {
    try {
      const subs = await getCustomerSubscriptions(user.id);
      const mapped: SubscriptionInfo[] = subs.map((s) => ({
        store: normalizeStore(s.store) as Store,
        productId: s.product_id,
        transactionId: s.store_subscription_identifier,
        originalTransactionId: s.store_subscription_identifier,
        periodType: s.status === "trialing" ? "TRIAL" : "NORMAL",
        isTrial: s.status === "trialing",
        lastEventType: `rc_v2:${s.status}`,
        lastEventAt: new Date().toISOString(),
        expiresAt: s.current_period_ends_at
          ? new Date(s.current_period_ends_at).toISOString()
          : null,
        cancelReason: null,
        isActive: s.gives_access,
        totalPaidUsd: Number(s.total_revenue_in_usd?.gross) || 0,
        plan: null,
        startedAt: null,
        autoRenew: s.auto_renewal_status
          ? s.auto_renewal_status === "will_renew"
          : null,
        renewals: null,
      }));
      derived = {
        subscriptions: mergeConsumerSubscriptions(mapped, consumerRows),
        totalSpentUsd: mapped.reduce((a, s) => a + s.totalPaidUsd, 0),
        sandboxOnly: derived.sandboxOnly,
      };
    } catch {
      // keep rc_events-derived (empty) state
    }
  }

  // Stripe money AND lifecycle truth come from Stripe, not the RC event
  // stream (which misses failed-then-retried charges and can skip
  // cancellation events entirely).
  const stripeTruth = await fetchStripeTruth(
    derived.subscriptions,
    user.email ?? email,
  );
  let { subscriptions, totalSpentUsd } = derived;
  if (stripeTruth !== null) {
    subscriptions = applyStripeStates(subscriptions, stripeTruth.states);
    ({ subscriptions, totalSpentUsd } = overrideStripeTotals(
      subscriptions,
      totalSpentUsd,
      stripeTruth.paidUsd,
    ));
  }

  // Matched app account but RC knows of no subscriptions at all: check
  // Stripe by email anyway. Web-checkout trials can exist with zero RC
  // events under this app user id (seen live: a trialing Stripe sub about
  // to bill while the tab said "no subscription on record").
  if (subscriptions.length === 0) {
    const lookupEmail = user.email ?? email;
    if (lookupEmail) {
      const viaStripe = await stripeFallback(lookupEmail);
      if (viaStripe) {
        subscriptions = viaStripe.subscriptions;
        totalSpentUsd = viaStripe.totalSpentUsd;
      }
    }
  }

  return {
    appUserId: user.id,
    email: user.email?.toLowerCase() ?? email?.toLowerCase() ?? null,
    name: userDisplayName(user),
    journeyStage: user.glp1_journey_stage,
    subscriptions,
    totalSpentUsd,
    noAccount: false,
    sandboxOnly: derived.sandboxOnly,
    accountCreatedAt: authInfo?.createdAt ?? null,
    lastSeenAt: authInfo?.lastSignInAt ?? null,
  };
}
