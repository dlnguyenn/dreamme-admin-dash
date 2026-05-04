/**
 * SpyTok-style virality signals layered on top of the absolute-threshold
 * logic in spy-viral.ts.
 *
 * The absolute thresholds (50K/7d, 10K/48h) flag posts that are big in
 * raw terms. They miss the case that actually matters: a creator whose
 * baseline is 800 views suddenly hitting 30K. To them that's a hit; to
 * us with absolute thresholds it's invisible.
 *
 * computeOutlierScore = view_count / median(author's last ~10 posts).
 *   >= 5x  → strong outlier, flag viral
 *   >= 3x  → notable, surface but don't flag
 *   < 3x   → likely noise
 *
 * computeViewsPerHour is a cheap velocity signal that doesn't need a
 * profile scrape. Useful as a tiebreaker on the Trends tab.
 */

import { computeIsViral, type ViralCandidate } from "./spy-viral";

export const OUTLIER_VIRAL_THRESHOLD = 5;
export const OUTLIER_NOTABLE_THRESHOLD = 3;
export const MIN_BASELINE_POSTS = 3;

export function computeViewsPerHour(
  view_count: number | null,
  posted_at: string | null,
  now: Date = new Date(),
): number | null {
  if (view_count == null || !posted_at) return null;
  const ts = Date.parse(posted_at);
  if (isNaN(ts)) return null;
  const ageHours = Math.max(1, (now.getTime() - ts) / (60 * 60 * 1000));
  if (ageHours < 0) return null;
  return view_count / ageHours;
}

export function computeBaselineMedian(viewCounts: number[]): number | null {
  if (viewCounts.length < MIN_BASELINE_POSTS) return null;
  const sorted = [...viewCounts].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

export function computeOutlierScore(
  view_count: number,
  baseline_median: number | null,
): number | null {
  if (baseline_median == null || baseline_median <= 0) return null;
  return view_count / baseline_median;
}

/**
 * Outlier-first viral check. If we have a credible baseline, use the
 * outlier multiplier. Otherwise fall back to the absolute thresholds.
 */
export function isViralOutlier(opts: {
  view_count: number | null;
  posted_at: string | null;
  outlier_score: number | null;
  now?: Date;
}): boolean {
  if (opts.outlier_score != null) {
    return opts.outlier_score >= OUTLIER_VIRAL_THRESHOLD;
  }
  const candidate: ViralCandidate = {
    view_count: opts.view_count,
    posted_at: opts.posted_at,
  };
  return computeIsViral(candidate, opts.now);
}
