/**
 * Pure half of src/lib/store-reviews.ts: types, store links and the
 * "needs attention" rules. Split out so the Store Reviews tab (a client
 * component) can import it without pulling node:crypto into the browser.
 */

export const ASC_APP_ID = "6755569693";
export const PLAY_PACKAGE = "com.dreamme.app";
export const STORE_LINKS = {
  app_store: `https://appstoreconnect.apple.com/apps/${ASC_APP_ID}/distribution/activity/ios/ratingsResponses`,
  google_play: "https://play.google.com/console/developers/7804193053424026014/app/4976034496613406446/user-feedback/reviews",
} as const;

export type Store = "app_store" | "google_play";

export interface StoreReviewRow {
  id: string;
  store: Store;
  review_id: string;
  rating: number;
  title: string | null;
  body: string;
  reviewer: string | null;
  territory: string | null;
  language: string | null;
  app_version: string | null;
  device: string | null;
  reviewed_at: string;
  reply_body: string | null;
  replied_at: string | null;
  reply_state: string | null;
  first_seen_at?: string;
  last_synced_at?: string;
  handled_at?: string | null;
}

// ── Attention rules (pure) ─────────────────────────────────────────────

export type AttentionReason = "billing" | "broken" | "low_rating" | "edited_after_reply";

export const REASON_LABELS: Record<AttentionReason, string> = {
  billing: "Billing / paywall",
  broken: "App broken",
  low_rating: "Low rating",
  edited_after_reply: "Edited after reply",
};

const BILLING =
  /\b(refunds?|charg(e|ed|es|ing)|money|scam\w*|cancel\w*|subscri\w*|pay|paid|paying|paywall|price\w*|pricing|cost\w*|expensive|trial|billed|billing)\b|\$\d/i;
const BROKEN =
  /\b(crash\w*|bugs?|buggy|glitch\w*|not (working|loading)|doesn't work|does not work|won't (load|open|let)|stopped working|lost (all )?(of )?(my )?(data|progress|info\w*)|can't (log ?in|sign in|access|find my account|get in)|logged (me )?out|kicked me out|error\w*|stuck|freez\w*|spinning)\b/i;

export interface Attention {
  needsAttention: boolean;
  urgent: boolean;
  reasons: AttentionReason[];
}

const NONE: Attention = { needsAttention: false, urgent: false, reasons: [] };

export function attentionFor(r: Pick<StoreReviewRow, "rating" | "title" | "body" | "reviewed_at" | "replied_at" | "reply_body" | "handled_at">): Attention {
  const reviewed = Date.parse(r.reviewed_at);
  if (r.handled_at && Date.parse(r.handled_at) >= reviewed) return NONE;
  const editedAfterReply = !!r.replied_at && Date.parse(r.replied_at) < reviewed;
  if (r.reply_body && !editedAfterReply) return NONE;

  const text = `${r.title ?? ""} ${r.body}`.replace(/[‘’]/g, "'");
  const reasons: AttentionReason[] = [];
  if (r.rating <= 3 && BILLING.test(text)) reasons.push("billing");
  if (BROKEN.test(text)) reasons.push("broken");
  if (r.rating <= 3 && !reasons.length) reasons.push("low_rating");
  if (!reasons.length) return NONE; // a happy edit after our reply needs nothing
  if (editedAfterReply) reasons.unshift("edited_after_reply");
  return { needsAttention: true, urgent: reasons.includes("billing") || reasons.includes("broken"), reasons };
}

export interface StoreSummary {
  store: Store;
  count: number;
  avgRating: number | null;
  avgRating30d: number | null;
  count30d: number;
  needsAttention: number;
  unreplied: number;
  lastSyncedAt: string | null;
}

export function summarizeStore(store: Store, rows: StoreReviewRow[], now = Date.now()): StoreSummary {
  const mine = rows.filter((r) => r.store === store);
  const recent = mine.filter((r) => now - Date.parse(r.reviewed_at) <= 30 * 86_400_000);
  const avg = (xs: StoreReviewRow[]) => (xs.length ? xs.reduce((s, r) => s + r.rating, 0) / xs.length : null);
  const synced = mine.map((r) => r.last_synced_at).filter((x): x is string => !!x).sort();
  return {
    store,
    count: mine.length,
    avgRating: avg(mine),
    avgRating30d: avg(recent),
    count30d: recent.length,
    needsAttention: mine.filter((r) => attentionFor(r).needsAttention).length,
    unreplied: mine.filter((r) => !r.reply_body).length,
    lastSyncedAt: synced.length ? synced[synced.length - 1] : null,
  };
}

export interface SyncResult {
  store: Store;
  ok: boolean;
  fetched: number;
  error?: string;
}
