/**
 * Free-text search queries scraped daily by /api/cron/scrape-spy in
 * addition to the hashtag list in spy-hashtags.ts. Catches videos that
 * mention the term in caption / hook but aren't tagged with our niche
 * hashtags.
 *
 * Cost note: each query is ~$0.30/day in Apify credits. With 2 queries
 * it's ~$0.60/day = ~$18/month on top of the existing ~$80/month
 * hashtag spend.
 *
 * Edit + redeploy to add/remove queries.
 */
export const SPY_QUERIES = [
  "GLP-1",
  "GLP1",
] as const;

export type SpyQuery = (typeof SPY_QUERIES)[number];
