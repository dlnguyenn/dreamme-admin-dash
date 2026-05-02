/**
 * Viral threshold for the Spy Tool.
 *
 * A spy video is "viral" if EITHER bar is crossed (logical OR):
 *   - mature: view_count >= 50,000 AND posted within last 7 days
 *   - early-velocity: view_count >= 10,000 AND posted within last 48 hours
 *
 * The mature threshold catches established hits; the early-velocity
 * threshold catches rocketships before they fully blow up so we can
 * spy on them while attention is still building. Either firing flags
 * the video.
 */

export const MATURE_VIEW_THRESHOLD = 50_000;
export const MATURE_WINDOW_DAYS = 7;

export const EARLY_VIEW_THRESHOLD = 10_000;
export const EARLY_WINDOW_HOURS = 48;

export interface ViralCandidate {
  view_count: number | null;
  posted_at: string | null;
}

export function computeIsViral(
  candidate: ViralCandidate,
  now: Date = new Date(),
): boolean {
  if (candidate.view_count == null || !candidate.posted_at) return false;
  const postedTs = Date.parse(candidate.posted_at);
  if (isNaN(postedTs)) return false;
  const ageHours = (now.getTime() - postedTs) / (60 * 60 * 1000);
  if (ageHours < 0) return false;
  const ageDays = ageHours / 24;

  const matureHit =
    ageDays <= MATURE_WINDOW_DAYS && candidate.view_count >= MATURE_VIEW_THRESHOLD;
  const earlyHit =
    ageHours <= EARLY_WINDOW_HOURS && candidate.view_count >= EARLY_VIEW_THRESHOLD;
  return matureHit || earlyHit;
}
