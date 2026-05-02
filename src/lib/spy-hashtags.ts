/**
 * Hashtags scraped daily by /api/cron/scrape-spy. Edit + redeploy to
 * change. A user-managed table is a Phase 2 polish.
 *
 * Cost note: each hashtag scrape is ~$0.30 in Apify credits. With 9
 * hashtags daily, expect ~$2.70/day = ~$80/month. Trim if cost climbs.
 */
export const SPY_HASHTAGS = [
  "glp1",
  "ozempic",
  "wegovy",
  "mounjaro",
  "semaglutide",
  "tirzepatide",
  "glp1journey",
  "ozempicweightloss",
  "glp1community",
] as const;

export type SpyHashtag = (typeof SPY_HASHTAGS)[number];

export function isSpyHashtag(v: unknown): v is SpyHashtag {
  return typeof v === "string" && (SPY_HASHTAGS as readonly string[]).includes(v);
}
