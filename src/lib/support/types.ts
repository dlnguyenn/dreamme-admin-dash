/**
 * Support Inbox — shared row/domain types used by both the API routes and the
 * client components. Keep this file free of server-only imports.
 */

export type ThreadSource = "email" | "feedback";
export type ThreadStatus =
  | "new"
  | "drafts_ready"
  | "waiting_user"
  | "closed"
  | "ignored";
export type ThreadCategory =
  | "refund_request"
  | "cancel_trial"
  | "question"
  | "feedback"
  | "other";
export type Store = "STRIPE" | "PLAY_STORE" | "APP_STORE";

export interface SupportThreadRow {
  id: string;
  source: ThreadSource;
  channel: string | null;
  status: ThreadStatus;
  snoozed_until: string | null;
  unread: boolean;
  subject: string | null;
  counterpart_email: string | null;
  counterpart_name: string | null;
  category: ThreadCategory | null;
  urgency: "low" | "normal" | "high" | null;
  resolved_app_user_id: string | null;
  resolved_store: Store | null;
  user_context: UserContext | null;
  triage: TriageResult | null;
  feedback_id: string | null;
  last_message_at: string;
  last_inbound_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupportMessageRow {
  id: string;
  thread_id: string;
  direction: "inbound" | "outbound";
  via: "email" | "feedback";
  message_id: string | null;
  in_reply_to: string | null;
  references_ids: string[];
  from_email: string | null;
  /** sender display name as it arrived (From header / feedback user_name) */
  from_name: string | null;
  to_email: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  attachments: AttachmentInfo[] | null;
  imap_uid: number | null;
  sent_at: string;
  created_at: string;
}

export interface AttachmentInfo {
  filename?: string;
  contentType?: string;
  size?: number;
  /** consumer-storage URL for in-app feedback screenshots */
  url?: string;
}

export interface SupportDraftRow {
  id: string;
  thread_id: string;
  generation: number;
  variant: number;
  body: string;
  model: string | null;
  status: "proposed" | "edited" | "sent" | "discarded";
  created_at: string;
  updated_at: string;
}

/** Mutating subscription actions (stripe_lookup is read-only, never logged). */
export type SubscriptionActionType =
  | "stripe_cancel_at_period_end"
  | "stripe_cancel_now"
  | "stripe_refund"
  | "rc_play_refund_revoke";

/**
 * Everything the audit log locks after one success. Trello card creation
 * isn't a subscription action — it touches no money and no store — but it
 * shares the "don't do this twice" machinery.
 */
export type SupportActionType = SubscriptionActionType | "trello_create_card";

export interface SupportActionRow {
  id: string;
  thread_id: string | null;
  app_user_id: string | null;
  store: string | null;
  action_type: string;
  request: Record<string, unknown> | null;
  response: Record<string, unknown> | null;
  status: "success" | "error";
  error: string | null;
  created_at: string;
}

/** One RC subscription group (grouped by original_transaction_id). */
export interface SubscriptionInfo {
  store: Store | string;
  productId: string | null;
  /** Stripe: si_… subscription item id; Apple/Google: store transaction id */
  transactionId: string | null;
  originalTransactionId: string | null;
  periodType: string | null; // TRIAL | NORMAL | INTRO
  isTrial: boolean;
  /** latest lifecycle event type seen (INITIAL_PURCHASE, CANCELLATION, …) */
  lastEventType: string;
  lastEventAt: string;
  expiresAt: string | null;
  cancelReason: string | null;
  /** true when expiration is in the future */
  isActive: boolean;
  totalPaidUsd: number;
  /** yearly | quarterly | monthly | weekly | null when underivable */
  plan: string | null;
  /** original purchase date (subscription age) */
  startedAt: string | null;
  /** free-trial window — Stripe only; null when never trialed or unknown */
  trialStartedAt?: string | null;
  trialEndsAt?: string | null;
  autoRenew: boolean | null;
  renewals: number | null;
  /**
   * Raw Stripe subscription status (trialing | active | past_due | unpaid |
   * canceled | …) when the state came from Stripe itself. past_due/unpaid
   * matter: the subscription is NOT over — Stripe is still retrying the
   * card, and "inactive" was exactly the misread that told a past_due
   * customer she was safe (Maria M., 2026-08-05). Older stored contexts
   * carry the same fact in lastEventType ("stripe:past_due").
   */
  stripeStatus?: string | null;
}

export interface UserContext {
  appUserId: string | null;
  email: string | null;
  name: string | null;
  journeyStage: string | null;
  subscriptions: SubscriptionInfo[];
  totalSpentUsd: number;
  /** true when the email matched no consumer user */
  noAccount: boolean;
  /** true when only sandbox rc_events exist for this user */
  sandboxOnly: boolean;
  /** Supabase auth account creation (account age) */
  accountCreatedAt?: string | null;
  /** last app sign-in */
  lastSeenAt?: string | null;
  /**
   * Set when a human linked this thread to a Stripe customer by name
   * ("Maybe this user?"), because the sender emailed from an address that
   * matches no account. Marks the context as manually attached rather
   * than resolved, and drives the Unlink affordance.
   */
  linkedStripeCustomerId?: string | null;
  /**
   * FAILED Stripe charge attempts on the customer(s). "$0 collected" with
   * failed attempts behind it is a completely different situation from "$0,
   * never charged": every declined retry can show on the customer's bank
   * statement, which is usually the complaint itself.
   */
  stripeFailedCharges?: { count: number; lastAt: string | null } | null;
}

export interface TriageResult {
  is_spam: boolean;
  classification: ThreadCategory;
  urgency: "low" | "normal" | "high";
  summary: string;
  /** marks Dan's own test emails / internal senders */
  internal?: boolean;
  model?: string;
  error?: string;
  triaged_at?: string;
}

/** Shape returned by GET /api/support/threads/[id] */
export interface ThreadDetailPayload {
  thread: SupportThreadRow;
  messages: SupportMessageRow[];
  drafts: SupportDraftRow[];
  actions: SupportActionRow[];
}
