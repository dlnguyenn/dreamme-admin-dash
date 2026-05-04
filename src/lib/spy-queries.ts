/**
 * Free-text search queries scraped by /api/cron/scrape-spy in addition
 * to the hashtag list in spy-hashtags.ts. Catches videos that mention
 * the term in caption / hook but aren't tagged with our niche hashtags.
 *
 * Curated for GLP-1 transformation content specifically — these are the
 * query phrases creators actually use in captions, ranked roughly by
 * how clean the signal is. The 10K-view filter at insert time keeps the
 * long tail out of the library.
 *
 * Cost: ~$0.15 per query per run × 7 queries × 3 runs/week ≈ $14/month.
 *
 * Edit + redeploy to add/remove queries. Pruning low-yield queries
 * after a few weeks of data is cheap and worth doing.
 */
export const SPY_QUERIES = [
  "GLP-1",
  "GLP1",
  "glp1 transformation",
  "ozempic before and after",
  "weight loss with glp1",
  "glp1 journey",
  "semaglutide weight loss",
] as const;

export type SpyQuery = (typeof SPY_QUERIES)[number];
