/**
 * Daily search-rank check → aso_rank_checks (migration 0120).
 *
 * Uses the public iTunes Search API, the same method as the vault scripts
 * (raw-sources/.../our-data/scripts/rank_check_*.py): it approximates live App
 * Store search order, with no ad slot and no personalization, so ranks move a
 * few places day to day. The terms live in aso_rank_terms (not in this public
 * repo). Apple throttles at roughly 20 searches a minute, so each run checks
 * the terms not yet done today, ~3 s apart, until its time budget runs out;
 * the cron calls it twice a day, in different hours, to cover the whole list.
 */
import { spGet, spPost } from "@/lib/support/db";

export const TRACKED_APPS = { dreamme: 6755569693, meagain: 6744178534, shotsy: 6499510249 } as const;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

export interface RankTerm { term: string; country: string; term_sets: string[]; locale_tag: string | null; position: number }

interface ItunesResult { trackId: number; trackName: string; userRatingCount?: number }

/** 1-based position of each tracked app in a results list (null = not in it). */
export function positions(results: Pick<ItunesResult, "trackId">[]) {
  const pos = (id: number) => {
    const i = results.findIndex((r) => r.trackId === id);
    return i >= 0 ? i + 1 : null;
  };
  return { dreamme: pos(TRACKED_APPS.dreamme), meagain: pos(TRACKED_APPS.meagain), shotsy: pos(TRACKED_APPS.shotsy) };
}

async function search(term: string, country: string): Promise<ItunesResult[] | null> {
  const url = `https://itunes.apple.com/search?${new URLSearchParams({ term, entity: "software", country, limit: "200" })}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
      if (res.ok) return ((await res.json()) as { results: ItunesResult[] }).results ?? [];
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 6000 * (attempt + 1)));
  }
  return null;
}

export interface RankRunResult { ok: boolean; day: string; checked: number; failed: string[]; remaining: number }

/** UTC day the run belongs to. */
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

export async function runRankChecks(opts: { budgetMs?: number; gapMs?: number; now?: Date } = {}): Promise<RankRunResult> {
  const budgetMs = opts.budgetMs ?? 240_000;
  const gapMs = opts.gapMs ?? 3100;
  const started = Date.now();
  const day = utcDay(opts.now ?? new Date());
  const [terms, done] = await Promise.all([
    spGet<RankTerm[]>("aso_rank_terms?select=term,country,term_sets,locale_tag,position&active=eq.true&order=position"),
    spGet<{ term: string; country: string }[]>(`aso_rank_checks?select=term,country&day=eq.${day}`),
  ]);
  const doneKeys = new Set(done.map((d) => `${d.country}|${d.term}`));
  const todo = terms.filter((t) => !doneKeys.has(`${t.country}|${t.term}`));
  const failed: string[] = [];
  let checked = 0;
  for (const t of todo) {
    if (Date.now() - started > budgetMs) break;
    const results = await search(t.term, t.country);
    if (results == null) {
      failed.push(`${t.country}:${t.term}`);
    } else {
      await spPost(
        "aso_rank_checks",
        [{
          day, term: t.term, country: t.country, ...positions(results), results_n: results.length,
          top5: results.slice(0, 5).map((r, i) => ({ pos: i + 1, id: r.trackId, name: r.trackName, ratings: r.userRatingCount ?? null })),
          source: "cron", checked_at: new Date().toISOString(),
        }],
        { onConflict: "day,term,country", resolution: "merge" },
      );
      checked++;
    }
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return { ok: failed.length === 0, day, checked, failed, remaining: todo.length - checked - failed.length };
}
