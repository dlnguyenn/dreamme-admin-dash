/**
 * Builds the App Store listing (ASO) tab payload from Supabase only:
 * aso_store_daily, aso_rank_terms/checks, aso_markers,
 * app_store_rating_snapshots and the "ASO n" rows of plan_todos.
 */
import { spGet } from "@/lib/support/db";
import { ascAnalyticsConfigured } from "./asc-analytics";

import { BASELINE_DAY, buildTermViews, localeVerdict, rankGain, type LocaleVerdict, type MarkerRow, type RankCheckRow, type RankTermRow, type RatingRow, type StoreDailyRow, type TermView, type TodoRow } from "./logic";

export { BASELINE_DAY, buildTermViews, localeVerdict, rankGain };
export type { LocaleVerdict, MarkerRow, RankCheckRow, RankTermRow, RatingRow, StoreDailyRow, TermView, TodoRow };

export interface AsoPayload {
  ok: true;
  configured: { asc: boolean };
  store_daily: StoreDailyRow[];
  store_synced_at: string | null;
  terms: TermView[];
  ranks_last_day: string | null;
  locales: { locale_tag: string; terms: number; checked: number; best: number | null; verdict: LocaleVerdict }[];
  ratings: RatingRow[];
  markers: MarkerRow[];
  todos: TodoRow[];
}

export async function buildAsoPayload(): Promise<AsoPayload> {
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  const [store, synced, terms, checks, ratings, markers, todos] = await Promise.all([
    spGet<StoreDailyRow[]>(`aso_store_daily?select=day,territory,source_type,impressions,impressions_unique,page_views,page_views_unique,first_downloads,redownloads&day=gte.${since}&order=day`),
    spGet<{ synced_at: string }[]>("aso_store_daily?select=synced_at&order=synced_at.desc&limit=1"),
    spGet<RankTermRow[]>("aso_rank_terms?select=term,country,term_sets,locale_tag,position&active=eq.true&order=position"),
    spGet<RankCheckRow[]>(`aso_rank_checks?select=day,term,country,dreamme,meagain,shotsy,results_n,source&day=gte.${since}&order=day`),
    spGet<RatingRow[]>("app_store_rating_snapshots?select=day,territory,source,rating_count,average_rating&order=day"),
    spGet<MarkerRow[]>("aso_markers?select=id,day,label,kind&order=day"),
    spGet<TodoRow[]>("plan_todos?select=id,section,title,note,done,done_at,position&title=ilike.ASO*&order=position"),
  ]);
  const num = (v: unknown) => (v == null ? null : Number(v));
  const storeN = store.map((r) => ({
    ...r,
    impressions: Number(r.impressions), impressions_unique: Number(r.impressions_unique),
    page_views: Number(r.page_views), page_views_unique: Number(r.page_views_unique),
    first_downloads: Number(r.first_downloads), redownloads: Number(r.redownloads),
  }));
  const views = buildTermViews(terms, checks);

  const locales = new Map<string, TermView[]>();
  for (const v of views) {
    if (!v.term_sets.includes("locale-test") || !v.locale_tag) continue;
    if (!locales.has(v.locale_tag)) locales.set(v.locale_tag, []);
    locales.get(v.locale_tag)!.push(v);
  }

  // Sort "ASO 1".."ASO 11" by their number, not their row position.
  const n = (t: string) => Number(/^ASO\s*(\d+)/i.exec(t)?.[1] ?? 999);

  return {
    ok: true,
    configured: { asc: ascAnalyticsConfigured() },
    store_daily: storeN,
    store_synced_at: synced[0]?.synced_at ?? null,
    terms: views,
    ranks_last_day: checks.length ? checks.map((c) => c.day).sort().at(-1)! : null,
    locales: [...locales].map(([locale_tag, vs]) => {
      const ranked = vs.map((v) => v.latest?.dreamme).filter((x): x is number => x != null);
      const best = ranked.length ? Math.min(...ranked) : null;
      const checked = vs.filter((v) => v.latest).length;
      return { locale_tag, terms: vs.length, checked, best, verdict: localeVerdict(best, checked > 0) };
    }),
    ratings: ratings.map((r) => ({ ...r, rating_count: Number(r.rating_count), average_rating: num(r.average_rating) })),
    markers,
    todos: [...todos].sort((a, b) => n(a.title) - n(b.title)),
  };
}
