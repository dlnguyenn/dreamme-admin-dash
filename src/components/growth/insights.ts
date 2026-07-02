"use client";

/**
 * Growth AI · Insights math — pure, UI-free rollups over ad aggregates +
 * AI creative tags. Powers the Messaging Themes wall and the
 * compare-by-dimension breakdowns (Motion's themes page + comparative
 * reports).
 */

import {
  type GrowthAdRow,
  type CreativeTag,
  type AdAgg,
  aggregateAds,
  sliceWindows,
  daysAgoISO,
  safeDiv,
} from "./data";

// --- hit rate ---------------------------------------------------------------
// Motion shows a "hit rate" per theme. Ours is robust to sparse trials:
//   qualified ad = spend ≥ $30 in the window
//   hit          = ≥1 trial AND cpt ≤ 1.2 × account median CPT
//                  (median over ads with ≥1 trial in the same window)
//   hit_rate     = hits ÷ qualified   (null when nothing qualified)

export const QUALIFY_SPEND = 30;

export function accountMedianCpt(aggs: AdAgg[]): number | null {
  const cpts = aggs
    .filter((a) => a.trial_starts >= 1 && a.spend > 0)
    .map((a) => a.spend / a.trial_starts)
    .sort((a, b) => a - b);
  if (cpts.length === 0) return null;
  const mid = Math.floor(cpts.length / 2);
  return cpts.length % 2 ? cpts[mid] : (cpts[mid - 1] + cpts[mid]) / 2;
}

export function isHit(a: AdAgg, medianCpt: number | null): boolean {
  if (a.trial_starts < 1) return false;
  if (medianCpt == null) return true; // it has trials and there's no baseline
  return a.spend / a.trial_starts <= medianCpt * 1.2;
}

// --- theme rollups ------------------------------------------------------------

export type ThemeStatus = "proven" | "scaling" | "declining" | "testing";

export interface ThemeRollup {
  theme: string;
  description: string;
  ads: AdAgg[];
  activeCount: number;
  spend: number;
  spendPrev7: number;
  spend7: number;
  wowPct: number | null;
  trials: number;
  cpt: number; // NaN when no trials
  thumbs: string[];
  qualified: number;
  hits: number;
  hitRate: number | null;
  status: ThemeStatus;
}

export function themeRollups(
  rows: GrowthAdRow[],
  tags: Map<string, CreativeTag>,
): ThemeRollup[] {
  if (tags.size === 0) return [];
  // Full-window (56d) aggregates for spend/status; 7d slices for WoW.
  const full = aggregateAds(rows);
  const { cur: cur7, prev: prev7 } = sliceWindows(rows, 7);
  const fullAggs = [...full.values()];
  const median = accountMedianCpt(fullAggs);

  const byTheme = new Map<string, { description: string; ads: AdAgg[] }>();
  for (const a of fullAggs) {
    const tag = tags.get(a.ad_id);
    if (!tag) continue;
    let t = byTheme.get(tag.messaging_theme);
    if (!t) {
      t = { description: tag.theme_description ?? "", ads: [] };
      byTheme.set(tag.messaging_theme, t);
    }
    t.ads.push(a);
    // Prefer the description from the highest-spending ad (first wins after sort below).
  }

  const out: ThemeRollup[] = [];
  for (const [theme, { ads }] of byTheme) {
    const sorted = [...ads].sort((a, b) => b.spend - a.spend);
    const topTag = tags.get(sorted[0].ad_id);
    const spend = sorted.reduce((s, a) => s + a.spend, 0);
    const trials = sorted.reduce((s, a) => s + a.trial_starts, 0);
    const spend7 = sorted.reduce((s, a) => s + (cur7.get(a.ad_id)?.spend ?? 0), 0);
    const spendPrev7 = sorted.reduce((s, a) => s + (prev7.get(a.ad_id)?.spend ?? 0), 0);
    const wowPct = spendPrev7 > 0 ? ((spend7 - spendPrev7) / spendPrev7) * 100 : null;
    const qualifiedAds = sorted.filter((a) => a.spend >= QUALIFY_SPEND);
    const hits = qualifiedAds.filter((a) => isHit(a, median)).length;
    const hitRate = qualifiedAds.length > 0 ? hits / qualifiedAds.length : null;
    const activeCount = sorted.filter((a) => a.effective_status === "ACTIVE").length;

    // Status ladder (first match wins). Hit rate leads; spend WoW alone
    // doesn't demote a theme — pausing ads in a WORKING theme shouldn't
    // read as "declining".
    let status: ThemeStatus = "testing";
    if (spend >= 500 && hitRate != null && hitRate >= 0.4) status = "proven";
    else if (wowPct != null && wowPct >= 25 && spend7 >= 50) status = "scaling";
    else if (
      (wowPct != null && wowPct <= -25 && hitRate != null && hitRate < 0.25 && spendPrev7 >= 50) ||
      (hitRate != null && hitRate < 0.2 && spend >= 1000)
    )
      status = "declining";

    out.push({
      theme,
      description: topTag?.theme_description ?? "",
      ads: sorted,
      activeCount,
      spend,
      spend7,
      spendPrev7,
      wowPct,
      trials,
      cpt: safeDiv(spend, trials),
      thumbs: sorted
        .map((a) => a.thumbnail)
        .filter(Boolean)
        .slice(0, 4),
      qualified: qualifiedAds.length,
      hits,
      hitRate,
      status,
    });
  }
  return out.sort((a, b) => b.spend - a.spend);
}

// --- compare by dimension ------------------------------------------------------

export const COMPARE_DIMENSIONS = [
  { id: "visual_format", label: "Visual format" },
  { id: "messaging_theme", label: "Messaging theme" },
  { id: "audience", label: "Audience" },
  { id: "media_type", label: "Video vs static" },
  { id: "campaign", label: "Campaign" },
  { id: "persona", label: "Persona" },
] as const;

export type CompareDimension = (typeof COMPARE_DIMENSIONS)[number]["id"];

export interface CompareGroup {
  key: string;
  ads: number;
  spend: number;
  trials: number;
  cpt: number; // NaN when no trials
  hook: number; // NaN when no impressions
  ctr: number;
  impressions: number;
}

/** Best-effort persona from ad names like "Batch2 Ad - Kylie Houston". */
export function personaOf(adName: string): string {
  const afterDash = adName.split(/[-—–]/).pop()?.trim() ?? "";
  const words = afterDash.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && /^[A-Z][a-z]+$/.test(words[0] ?? "")) {
    return words[0];
  }
  return "Other";
}

export function compareByDimension(
  rows: GrowthAdRow[],
  tags: Map<string, CreativeTag>,
  dim: CompareDimension,
  days: number,
): CompareGroup[] {
  const windowRows = rows.filter((x) => x.date >= daysAgoISO(days - 1));
  const aggs = [...aggregateAds(windowRows).values()];

  const keyOf = (a: AdAgg): string | null => {
    if (dim === "media_type") return a.is_video ? "Video" : "Static";
    if (dim === "campaign") return a.campaign_name || "(unknown)";
    if (dim === "persona") return personaOf(a.ad_name);
    const tag = tags.get(a.ad_id);
    if (!tag) return null; // untagged ads drop out of tag dimensions
    if (dim === "visual_format") return tag.visual_format;
    if (dim === "messaging_theme") return tag.messaging_theme;
    return tag.audience || "(untagged)";
  };

  const groups = new Map<string, CompareGroup>();
  for (const a of aggs) {
    const key = keyOf(a);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = { key, ads: 0, spend: 0, trials: 0, cpt: NaN, hook: NaN, ctr: NaN, impressions: 0 };
      groups.set(key, g);
    }
    g.ads++;
    g.spend += a.spend;
    g.trials += a.trial_starts;
    g.impressions += a.impressions;
    // stash raw sums on the group for final derivation
    (g as unknown as { _clicks?: number })._clicks =
      ((g as unknown as { _clicks?: number })._clicks ?? 0) + a.clicks;
    (g as unknown as { _v3?: number })._v3 =
      ((g as unknown as { _v3?: number })._v3 ?? 0) + a.v3;
  }
  for (const g of groups.values()) {
    const clicks = (g as unknown as { _clicks?: number })._clicks ?? 0;
    const v3 = (g as unknown as { _v3?: number })._v3 ?? 0;
    g.cpt = safeDiv(g.spend, g.trials);
    g.hook = safeDiv(v3, g.impressions);
    g.ctr = safeDiv(clicks, g.impressions);
  }
  return [...groups.values()].sort((a, b) => b.spend - a.spend);
}

/** Visual formats from the taxonomy that no tagged ad uses yet (Motion's
 *  "formats you haven't tried"). */
export function untriedFormats(
  tags: Map<string, CreativeTag>,
  taxonomy: Array<{ id: string; label: string }>,
): string[] {
  if (tags.size === 0) return [];
  const used = new Set([...tags.values()].map((t) => t.visual_format));
  return taxonomy.filter((f) => !used.has(f.id) && f.id !== "other").map((f) => f.label);
}
