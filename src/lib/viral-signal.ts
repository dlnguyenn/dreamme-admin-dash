/**
 * Viral velocity detection for the n8n Content Pipeline endpoint.
 *
 * A persona's last N posts are evaluated. A post is "viral" if its
 * view_count crosses EITHER threshold within a recent time window:
 *   - absolute: view_count >= 10_000 within last 48h
 *   - persona-relative: view_count >= 3 × persona's rolling median
 *
 * Either-bar firing means the dimension that matters wins. Smaller
 * accounts can hit relative without crossing absolute; larger accounts
 * with a high baseline still get rewarded for outsized lifts.
 */

import type { PersonaBaseline } from "./baseline";

export const ABSOLUTE_VIEW_THRESHOLD = 10_000;
export const VIRAL_WINDOW_HOURS = 48;
export const RELATIVE_MULTIPLIER = 3;
export const RECENT_POSTS_TO_EVALUATE = 5;

export type ViralReason = "absolute" | "relative" | "both";

export interface ViralPost {
  id: string;
  view_count: number;
  posted_at: string;
  reason: ViralReason;
}

export interface ViralSignal {
  evaluated: number;
  viralCount: number;
  viralPosts: ViralPost[];
  thresholds: {
    absoluteViews: number;
    relativeMultiplier: number;
    windowHours: number;
    personaMedian: number | null;
  };
}

export interface ViralCandidatePost {
  id: string;
  view_count: number | null;
  posted_at: string | null;
}

export function computeViralSignal(
  posts: ViralCandidatePost[],
  baseline: PersonaBaseline | null,
  options: {
    absoluteThreshold?: number;
    windowHours?: number;
    relativeMultiplier?: number;
    now?: Date;
  } = {},
): ViralSignal {
  const absoluteThreshold = options.absoluteThreshold ?? ABSOLUTE_VIEW_THRESHOLD;
  const windowHours = options.windowHours ?? VIRAL_WINDOW_HOURS;
  const relativeMultiplier = options.relativeMultiplier ?? RELATIVE_MULTIPLIER;
  const now = (options.now ?? new Date()).getTime();
  const cutoff = now - windowHours * 60 * 60 * 1000;
  const median =
    baseline && baseline.rolling_median_views > 0
      ? baseline.rolling_median_views
      : null;
  const relativeBar = median !== null ? median * relativeMultiplier : null;

  const viralPosts: ViralPost[] = [];
  for (const p of posts) {
    if (p.view_count == null || !p.posted_at) continue;
    const postedTs = Date.parse(p.posted_at);
    if (isNaN(postedTs) || postedTs < cutoff) continue;

    const hitsAbsolute = p.view_count >= absoluteThreshold;
    const hitsRelative = relativeBar !== null && p.view_count >= relativeBar;
    if (!hitsAbsolute && !hitsRelative) continue;

    const reason: ViralReason =
      hitsAbsolute && hitsRelative
        ? "both"
        : hitsAbsolute
          ? "absolute"
          : "relative";

    viralPosts.push({
      id: p.id,
      view_count: p.view_count,
      posted_at: p.posted_at,
      reason,
    });
  }

  return {
    evaluated: posts.length,
    viralCount: viralPosts.length,
    viralPosts,
    thresholds: {
      absoluteViews: absoluteThreshold,
      relativeMultiplier,
      windowHours,
      personaMedian: median,
    },
  };
}

export function decideMode(signal: ViralSignal): "explore" | "exploit" {
  return signal.viralCount >= 1 ? "explore" : "exploit";
}
