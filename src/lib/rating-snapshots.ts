/**
 * Daily App Store rating-count snapshots (table app_store_rating_snapshots).
 *
 * Apple only publishes a running total of ratings (the public iTunes lookup),
 * so the store-reviews cron takes one snapshot a day per territory and the
 * day-to-day difference is "ratings that day". The lookup is cached by Akamai
 * for up to 24 h, so every request carries a throwaway query param; without it
 * a day-old count comes back (seen 2026-11-16: 3,472 cached vs 3,514 fresh).
 */
import { spPost } from "@/lib/support/db";

export const IOS_APP_ID = "6755569693";
export const RATING_TERRITORIES = ["us", "ca", "gb", "au"] as const;

export interface RatingSnapshot {
  day: string; // YYYY-MM-DD (UTC)
  territory: string;
  source: "lookup";
  rating_count: number;
  average_rating: number | null;
  app_version: string | null;
}

/** The lookup URL for one territory, with a cache-busting param. */
export function lookupUrl(territory: string, bust: string | number = Date.now()): string {
  return `https://itunes.apple.com/lookup?id=${IOS_APP_ID}&country=${encodeURIComponent(territory)}&cb=${bust}`;
}

/** Read the count out of a lookup response. Null when the app isn't listed there. */
export function parseLookup(
  json: unknown,
): { rating_count: number; average_rating: number | null; app_version: string | null } | null {
  const results = (json as { results?: unknown[] } | null)?.results;
  const r = Array.isArray(results) ? (results[0] as Record<string, unknown> | undefined) : undefined;
  if (!r) return null;
  const count = Number(r.userRatingCount);
  if (!Number.isInteger(count) || count < 0) return null;
  const avg = Number(r.averageUserRating);
  return {
    rating_count: count,
    average_rating: Number.isFinite(avg) ? Math.round(avg * 1000) / 1000 : null,
    app_version: typeof r.version === "string" ? r.version : null,
  };
}

/** UTC calendar day, YYYY-MM-DD. */
export function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export interface RatingSnapshotResult {
  territory: string;
  ok: boolean;
  rating_count?: number;
  error?: string;
}

/**
 * Take today's snapshot for every territory and upsert it (a re-run the same
 * day overwrites with the newer count). One territory failing doesn't stop
 * the others.
 */
export async function snapshotRatings(now: Date = new Date()): Promise<RatingSnapshotResult[]> {
  const day = utcDay(now);
  const out: RatingSnapshotResult[] = [];
  for (const territory of RATING_TERRITORIES) {
    try {
      const res = await fetch(lookupUrl(territory, now.getTime()), { cache: "no-store" });
      if (!res.ok) throw new Error(`lookup ${res.status}`);
      const parsed = parseLookup(await res.json());
      if (!parsed) throw new Error("app not listed in this territory");
      const row: RatingSnapshot = { day, territory, source: "lookup", ...parsed };
      await spPost("app_store_rating_snapshots", [{ ...row, fetched_at: now.toISOString() }], {
        onConflict: "day,territory,source",
        resolution: "merge",
      });
      out.push({ territory, ok: true, rating_count: parsed.rating_count });
    } catch (e) {
      out.push({ territory, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}
