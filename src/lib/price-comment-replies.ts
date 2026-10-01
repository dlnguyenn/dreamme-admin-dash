/**
 * Price-comment auto-replier: pure helpers. The route
 * (src/app/api/cron/price-comment-replies/route.ts) does the I/O.
 *
 * A comment gets a reply only when Claude classifies it as a price objection
 * or question with confidence >= MIN_CONFIDENCE, it isn't ours, we haven't
 * answered it already, and we haven't already replied to that person on that
 * ad. Replies only ever say there is a free version: no medical content.
 */

/** House rule: no em dashes. Keep these short, warm and true for every user. */
export const REPLY_VARIANTS: readonly string[] = [
  "Good news: there's a free version! Download DreamMe and start tracking without paying a thing 💕",
  "Totally get it! DreamMe has a free version, and premium is completely optional 🐟",
  "No need to pay! There's a free version you can use as long as you like 💕",
  "Fair question! You can use DreamMe for free. Premium just adds extras 🐟",
];

export const MIN_CONFIDENCE = 0.8;
export const CLASSIFY_BATCH = 40;

export type Platform = "fb" | "ig";
export type Intent = "price" | "other";

export interface AdComment {
  platform: Platform;
  commentId: string;
  adId: string;
  adName: string;
  objectId: string;
  /** FB user id or IG username; null when Meta withholds the author. */
  authorKey: string | null;
  authorIsUs: boolean;
  alreadyRepliedByUs: boolean;
  text: string;
  createdTime: string;
}

export interface Classification {
  intent: Intent;
  confidence: number;
}

export type ReplyStatus =
  | "replied"
  | "dry_run"
  | "not_price"
  | "own_comment"
  | "already_answered"
  | "dup_commenter"
  | "error";

/** Statuses that are final: the comment is never looked at again. */
export const TERMINAL: ReadonlySet<ReplyStatus> = new Set<ReplyStatus>([
  "replied",
  "not_price",
  "own_comment",
  "already_answered",
  "dup_commenter",
]);

/** Deterministic variant per comment, so a retry never posts different text. */
export function pickVariant(commentId: string, variants: readonly string[] = REPLY_VARIANTS): string {
  let h = 0;
  for (const ch of commentId) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return variants[h % variants.length];
}

/** Nothing to classify: empty, only @mentions, or emoji with no money signal. */
export function isTrivial(text: string): boolean {
  const stripped = text.replace(/@[\w.]+/g, "").trim();
  return !/[\p{L}\p{N}$€£💰💸🤑]/u.test(stripped);
}

export const CLASSIFIER_SYSTEM = `You label comments left on ads for DreamMe, a GLP-1 companion app (food scanning, protein and water goals, shot tracking, a pet fish).

intent "price" means the commenter is asking what it costs, says it is too expensive, asks whether it is free or needs a subscription, or complains about paying or subscriptions. Examples: "how much?", "price??", "is it free", "too expensive", "$$$", "another subscription lol", "how much is it a month", "cuánto cuesta".

intent "other" is everything else, including: what the app is called or how to get it, medication or side effect questions, praise, criticism of the ad or of GLP-1s, tags of friends, spam, trolling.

Return ONLY a JSON array, one object per input comment, in any order:
[{"id": "<comment id>", "intent": "price" | "other", "confidence": <0..1>}]`;

export function classifierInput(comments: Array<{ id: string; text: string }>): string {
  return JSON.stringify(comments.map((c) => ({ id: c.id, text: c.text.slice(0, 500) })));
}

/** Parse Claude's reply; ids it skipped or mangled are simply absent. */
export function parseClassifications(raw: unknown, ids: readonly string[]): Map<string, Classification> {
  const want = new Set(ids);
  const out = new Map<string, Classification>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : null;
    if (!id || !want.has(id)) continue;
    const intent: Intent = o.intent === "price" ? "price" : "other";
    const c = typeof o.confidence === "number" ? o.confidence : Number(o.confidence);
    out.set(id, { intent, confidence: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0 });
  }
  return out;
}

export const commenterKey = (adId: string, authorKey: string) => `${adId}:${authorKey}`;

/**
 * Decide what to do with one comment. Returns null when it can't be decided
 * yet (no classification), so it stays open for the next tick.
 * `repliedCommenters` holds commenterKey()s already answered on that ad and is
 * updated when this returns a reply, so two price comments from one person in
 * the same run get one reply.
 */
export function decide(
  c: AdComment,
  cls: Classification | undefined,
  repliedCommenters: Set<string>,
): { status: Exclude<ReplyStatus, "dry_run" | "error">; reply?: string } | null {
  if (c.authorIsUs) return { status: "own_comment" };
  if (c.alreadyRepliedByUs) return { status: "already_answered" };
  if (!cls) return null;
  if (cls.intent !== "price" || cls.confidence < MIN_CONFIDENCE) return { status: "not_price" };
  if (c.authorKey) {
    const k = commenterKey(c.adId, c.authorKey);
    if (repliedCommenters.has(k)) return { status: "dup_commenter" };
    repliedCommenters.add(k);
  }
  return { status: "replied", reply: pickVariant(c.commentId) };
}
