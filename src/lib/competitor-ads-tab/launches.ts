/**
 * Creative tests (modelled on Foreplay Spyder's screen of that name): a
 * brand's ads grouped by the day they launched, each with how long it ran.
 * A brand that launches a batch on one day and keeps only one or two running
 * is testing creatives; the one that outlasts the rest is the winner.
 *
 * Pure, so the view and the tests read the same rules. Dates are UTC days;
 * Meta's start and end dates are day stamps, so run lengths are whole days.
 */

import { addDays, dayOf, daysBetween, type AdView } from "./logic";

/** How far back the view reaches. */
export const LAUNCH_WINDOW_DAYS = 60;

export interface LaunchEntry {
  ad: AdView;
  /** Days from launch to Meta's end date, or to today while it still runs. 0 = stopped the day it started. */
  days: number;
  live: boolean;
  /** Share of the days since launch the ad ran (1 = ran every day so far), for the bar. */
  share: number;
  winner: boolean;
}

export interface LaunchDay {
  brand: string;
  day: string;
  /** Days from the launch day to today (at least 1): the longest any ad of the day could have run. */
  possible: number;
  /** Longest run first. */
  entries: LaunchEntry[];
  total: number;
  running: number;
  longest: number;
  /** How many ads share the longest run (more than 1 means no single winner). */
  atLongest: number;
  winner: LaunchEntry | null;
  /** Launched before the brand's tracking began, so ads that stopped early may be missing. */
  beforeTracking: boolean;
}

/** Run length in whole days, or null when the ad has no start date. */
export function launchRunDays(ad: Pick<AdView, "startedAt" | "endedAt">, today: string): number | null {
  if (!ad.startedAt) return null;
  return Math.max(0, daysBetween(ad.startedAt, ad.endedAt ?? today));
}

/**
 * Group ads by brand and launch day, newest day first. `today` is a UTC day
 * ("2026-11-22"); `trackedSince` maps a brand to the first time the scrape saw
 * any of its ads.
 *
 * The winner is the one ad that ran longest, when the day launched at least
 * two and no other ad ran as long. A tie (common, since end dates are whole
 * days) or a day where everything is still running has no winner.
 */
export function groupLaunches(
  ads: AdView[],
  today: string,
  opts: { windowDays?: number; trackedSince?: Record<string, string | null | undefined> } = {},
): LaunchDay[] {
  const from = addDays(today, -((opts.windowDays ?? LAUNCH_WINDOW_DAYS) - 1));
  const groups = new Map<string, { brand: string; day: string; ads: AdView[] }>();
  for (const a of ads) {
    if (!a.startedAt) continue;
    const day = dayOf(a.startedAt);
    if (day < from || day > today) continue;
    const key = `${a.brand}\u0000${day}`;
    const g = groups.get(key) ?? { brand: a.brand, day, ads: [] };
    g.ads.push(a);
    groups.set(key, g);
  }

  const out: LaunchDay[] = [];
  for (const g of groups.values()) {
    const possible = Math.max(1, daysBetween(g.day, today));
    const entries: LaunchEntry[] = g.ads.map((ad) => {
      const days = launchRunDays(ad, today) ?? 0;
      return { ad, days, live: ad.endedAt == null, share: Math.min(1, days / possible), winner: false };
    });
    entries.sort(
      (a, b) =>
        b.days - a.days ||
        Number(b.live) - Number(a.live) ||
        (a.ad.rank.now ?? Number.POSITIVE_INFINITY) - (b.ad.rank.now ?? Number.POSITIVE_INFINITY) ||
        a.ad.adArchiveId.localeCompare(b.ad.adArchiveId),
    );
    const longest = entries[0]?.days ?? 0;
    const atLongest = entries.filter((e) => e.days === longest).length;
    const winner = entries.length >= 2 && atLongest === 1 ? entries[0] : null;
    if (winner) winner.winner = true;
    const since = opts.trackedSince?.[g.brand];
    out.push({
      brand: g.brand,
      day: g.day,
      possible,
      entries,
      total: entries.length,
      running: entries.filter((e) => e.live).length,
      longest,
      atLongest,
      winner,
      beforeTracking: !!since && g.day < dayOf(since),
    });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day) || a.brand.localeCompare(b.brand));
}

/** Plain-words run length: "under a day", "1 day", "12 days". */
export function runText(days: number): string {
  if (days <= 0) return "under a day";
  return days === 1 ? "1 day" : `${days} days`;
}

/** The headline for a day: "1 of 38 still running", "all 4 still running", "none still running". */
export function runningText(d: Pick<LaunchDay, "running" | "total">): string {
  if (d.total === 1) return d.running ? "1 ad, still running" : "1 ad, stopped";
  if (d.running === d.total) return `all ${d.total} still running`;
  if (d.running === 0) return `none of ${d.total} still running`;
  return `${d.running} of ${d.total} still running`;
}
