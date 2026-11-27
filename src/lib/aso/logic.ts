/**
 * Pure ASO tab logic and row types, safe for the browser bundle (no server
 * imports). Used by src/lib/aso/read.ts and the tab; pinned by tests.
 */

/** The frozen baseline the 1.5.8 listing change is read against (vault wiki/aso-baseline-2026-11-16.md). */
export const BASELINE_DAY = "2026-11-16";

export interface StoreDailyRow {
  day: string;
  territory: "US" | "ALL";
  source_type: string;
  impressions: number;
  impressions_unique: number;
  page_views: number;
  page_views_unique: number;
  first_downloads: number;
  redownloads: number;
}
export interface RankCheckRow {
  day: string;
  term: string;
  country: string;
  dreamme: number | null;
  meagain: number | null;
  shotsy: number | null;
  results_n: number | null;
  source: string;
}
export interface RankTermRow { term: string; country: string; term_sets: string[]; locale_tag: string | null; position: number }
export interface MarkerRow { id: string; day: string; label: string; kind: string }
export interface RatingRow { day: string; territory: string; source: string; rating_count: number; average_rating: number | null }
export interface TodoRow { id: string; section: string; title: string; note: string | null; done: boolean; done_at: string | null; position: number }

export interface TermView extends RankTermRow {
  latest: RankCheckRow | null;
  baseline: RankCheckRow | null;
  week_ago: RankCheckRow | null;
  history: { day: string; rank: number | null }[];
}

export type LocaleVerdict = "keep" | "drop" | "watch" | "no data";

/**
 * The hidden-locale rule (vault wiki/aso.md): keep a locale whose terms reach
 * the top 20; one with nothing in the top 50 goes back or is removed.
 */
export function localeVerdict(bestRank: number | null, anyChecked: boolean): LocaleVerdict {
  if (!anyChecked) return "no data";
  if (bestRank != null && bestRank <= 20) return "keep";
  if (bestRank == null || bestRank > 50) return "drop";
  return "watch";
}

/** Rank change, positive = moved up (better). Null when either side is unranked. */
export function rankGain(before: number | null | undefined, after: number | null | undefined): number | null {
  if (before == null || after == null) return null;
  return before - after;
}

export function buildTermViews(terms: RankTermRow[], checks: RankCheckRow[]): TermView[] {
  const byTerm = new Map<string, RankCheckRow[]>();
  for (const c of checks) {
    const k = `${c.country}|${c.term}`;
    if (!byTerm.has(k)) byTerm.set(k, []);
    byTerm.get(k)!.push(c);
  }
  return terms.map((t) => {
    const rows = (byTerm.get(`${t.country}|${t.term}`) ?? []).sort((a, b) => a.day.localeCompare(b.day));
    const latest = rows.at(-1) ?? null;
    const baseline = rows.find((r) => r.day === BASELINE_DAY) ?? rows[0] ?? null;
    let weekAgo: RankCheckRow | null = null;
    if (latest) {
      const target = new Date(`${latest.day}T00:00:00Z`);
      target.setUTCDate(target.getUTCDate() - 7);
      const cut = target.toISOString().slice(0, 10);
      weekAgo = [...rows].reverse().find((r) => r.day <= cut) ?? null;
    }
    return { ...t, latest, baseline, week_ago: weekAgo, history: rows.map((r) => ({ day: r.day, rank: r.dreamme })) };
  });
}
