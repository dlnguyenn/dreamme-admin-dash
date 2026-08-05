/**
 * Pure display logic for the TikTok batch grid (src/components/SlideshowBatches).
 *
 * Split out of the component so it can be unit tested: vitest runs `.test.ts`
 * in a node environment with no JSX transform, so anything a test needs to
 * reach has to live outside a `.tsx` file.
 */
import type { Family } from "@/components/porcelain";

export interface BatchPost {
  id: string;
  batch_key: string;
  persona: string;
  sort_order: number;
  hook: string | null;
  second_line: string | null;
  engine: string | null;
  cta: string | null;
  sound: string | null;
  tier: string | null;
  caption_chars: number | null;
  caption: string | null;
  review_url: string | null;
  doublespeed_post_id: string | null;
  post_status: string | null;
  posted_at: string | null;
  public_post_url: string | null;
  image_url: string | null;
  /** Lifetime views joined from social_posts. null = not measured, NOT zero. */
  views: number | null;
}

export interface Batch {
  id: string;
  batch_key: string;
  batch_no: number | null;
  batch_date: string;
  status: string | null;
  experiment: string | null;
  note: string | null;
  render_note: string | null;
  post_count: number;
  posts: BatchPost[];
}

export const TIER_FAMILY: Record<string, Family> = {
  SHORT: "info",
  MED: "success",
  LONG: "attention",
};

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatBatchDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Live state summary for a batch.
 *
 * Deliberately NOT derived from slideshow_batches.status — that column holds a
 * free-text snapshot written once at publish time ("QUEUED (all 9, ...)"), so
 * showing it made three-week-old batches read as still queued. These counts
 * come from post_status, refreshed from Doublespeed.
 */
export function stateSummary(
  posts: Pick<BatchPost, "post_status" | "public_post_url">[],
  batchDate: string,
  today = isoToday(),
): { label: string; family: Family } | null {
  if (posts.length === 0) return null;
  const n = (s: string) => posts.filter((p) => p.post_status === s).length;
  const posted = n("posted") + n("succeeded");
  const queued = n("scheduled") + n("pending");
  const draft = n("draft");
  const failed = n("failed") + n("error");
  const total = posts.length;

  // Doublespeed drains its own queue within minutes, so anything still queued
  // the day after its batch date is stuck, not pending. Without this a post
  // that never publishes reads as a normal QUEUED forever -- exactly how b28
  // maya sat unpublished for 30 hours with the dashboard showing nothing wrong.
  const stale = batchDate < today;

  // A post can reach "posted" and still never produce a public URL, which
  // means it went nowhere. It is the most common silent failure in this
  // pipeline and the one the old view was least able to show, because
  // "posted" reads like success. Only judge it once the batch date has
  // passed: the URL lands a little after publish, so today's batch would
  // otherwise flap through a false alarm every morning.
  const noReach = posts.filter(
    (p) =>
      (p.post_status === "posted" || p.post_status === "succeeded") &&
      !p.public_post_url,
  ).length;

  if (failed > 0) return { label: `${failed} FAILED`, family: "danger" };
  if (draft > 0) return { label: `${draft} NOT POSTED`, family: "danger" };
  if (queued > 0 && stale)
    return { label: `${queued} STUCK IN QUEUE`, family: "danger" };
  if (noReach > 0 && stale)
    return { label: `${noReach} NO REACH`, family: "danger" };
  if (posted === total) return { label: "POSTED", family: "success" };
  if (queued === total) return { label: "QUEUED", family: "attention" };
  if (posted > 0 || queued > 0)
    return { label: `${posted}/${total} POSTED`, family: "attention" };
  return { label: "UNVERIFIED", family: "neutral" };
}

/**
 * Per-post problem label, or null when the post is fine.
 *
 * The batch pill says "1 NOT POSTED" but not WHICH persona, and finding the one
 * broken slide was the whole value of the batch-state work (it caught b28 maya
 * silently reverting to draft). So healthy tiles stay bare and only broken ones
 * get marked — the grid reads clean at a glance and a problem is impossible to
 * miss.
 *
 * Mirrors stateSummary's precedence and its `stale` guard, so a tile can never
 * contradict the batch pill above it.
 */
export function problemState(
  post: Pick<BatchPost, "post_status" | "public_post_url">,
  batchDate: string,
  today = isoToday(),
): string | null {
  const s = post.post_status;
  if (s === "failed" || s === "error") return "FAILED";
  if (s === "draft") return "NOT POSTED";
  const stale = batchDate < today;
  if ((s === "scheduled" || s === "pending") && stale) return "STUCK";
  if ((s === "posted" || s === "succeeded") && !post.public_post_url && stale)
    return "NO REACH";
  return null;
}

/**
 * Compact view count.
 *
 * null means "not measured" and renders as an em dash. 10 of 72 batch posts
 * have no social_posts row; showing 0 for those would claim nobody watched
 * them, which is a different and much worse statement than "we haven't
 * measured this one". A genuine 0 still renders as 0.
 */
export function fmtViews(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(v));
}
