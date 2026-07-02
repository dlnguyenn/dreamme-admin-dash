"use client";

/**
 * Client data layer for the Growth AI tab. One fetch of the last 56 days of
 * ad_insights_daily + rc_account_metrics_daily + the blended-efficiency view,
 * then every sub-view (overview, leaderboard, shifts, charts) derives from it
 * in memory — same pattern as CreativeAnalytics but window-sliced.
 */

import * as React from "react";
import { SUPABASE_URL, SUPABASE_ANON } from "@/lib/supabase";

export const WINDOW_DAYS = 56;

export interface GrowthAdRow {
  ad_id: string;
  date: string;
  ad_name: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  effective_status: string | null;
  spend: string | number;
  impressions: number;
  clicks: number;
  installs: number;
  trial_starts: number;
  purchases: number;
  purchase_value: string | number;
  thumbnail_url: string | null;
  image_url: string | null;
  video_id: string | null;
  video_3sec_views: number | null;
  video_thruplays: number | null;
}

export interface GrowthRcRow {
  date: string;
  mrr: string | number | null;
  revenue: string | number | null;
  active_subscriptions: number | null;
  active_trials: number | null;
  new_customers: number | null;
  trial_starts: number | null;
  trial_conversions: number | null;
  ltv_30d_per_paying_customer: string | number | null;
}

export interface BlendedRow {
  date: string;
  meta_spend_7d: string | number | null;
  revenue_7d: string | number | null;
  mer_7d: string | number | null;
  net_new_subs_7d: string | number | null;
  mrr_growth_7d: string | number | null;
}

export interface AdAgg {
  ad_id: string;
  ad_name: string;
  adset_name: string;
  campaign_id: string;
  campaign_name: string;
  effective_status: string;
  thumbnail: string;
  is_video: boolean;
  first_seen: string;
  last_active: string;
  spend: number;
  impressions: number;
  clicks: number;
  installs: number;
  trial_starts: number;
  purchases: number;
  v3: number;
  thru: number;
}

export const num = (v: string | number | null | undefined): number =>
  v == null ? 0 : typeof v === "number" ? v : Number(v) || 0;

export function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysAgoISO(n: number): string {
  return utcDate(new Date(Date.now() - n * 86_400_000));
}

async function sbSelect<T>(path: string): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON) throw new Error("Supabase not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase read failed: ${res.status}`);
  return res.json() as Promise<T[]>;
}

const AD_COLS =
  "ad_id,date,ad_name,adset_name,campaign_id,campaign_name,effective_status," +
  "spend,impressions,clicks,installs,trial_starts,purchases,purchase_value," +
  "thumbnail_url,image_url,video_id,video_3sec_views,video_thruplays";

/** Aggregate raw daily rows (already date-filtered by caller) per ad. */
export function aggregateAds(rows: GrowthAdRow[]): Map<string, AdAgg> {
  const map = new Map<string, AdAgg>();
  for (const x of rows) {
    let a = map.get(x.ad_id);
    if (!a) {
      a = {
        ad_id: x.ad_id,
        ad_name: x.ad_name ?? "",
        adset_name: x.adset_name ?? "",
        campaign_id: x.campaign_id ?? "",
        campaign_name: x.campaign_name ?? "",
        effective_status: x.effective_status ?? "",
        thumbnail: x.image_url || x.thumbnail_url || "",
        is_video: !!x.video_id,
        first_seen: x.date,
        last_active: x.date,
        spend: 0,
        impressions: 0,
        clicks: 0,
        installs: 0,
        trial_starts: 0,
        purchases: 0,
        v3: 0,
        thru: 0,
      };
      map.set(x.ad_id, a);
    }
    a.spend += num(x.spend);
    a.impressions += num(x.impressions);
    a.clicks += num(x.clicks);
    a.installs += num(x.installs);
    a.trial_starts += num(x.trial_starts);
    a.purchases += num(x.purchases);
    a.v3 += num(x.video_3sec_views);
    a.thru += num(x.video_thruplays);
    if (x.date < a.first_seen) a.first_seen = x.date;
    if (x.date >= a.last_active) {
      a.last_active = x.date;
      if (x.ad_name) a.ad_name = x.ad_name;
      if (x.effective_status) a.effective_status = x.effective_status;
      const thumb = x.image_url || x.thumbnail_url;
      if (thumb) a.thumbnail = thumb;
      if (x.video_id) a.is_video = true;
    }
  }
  return map;
}

export function safeDiv(a: number, b: number): number {
  return b > 0 ? a / b : NaN;
}

export interface GrowthData {
  rows: GrowthAdRow[];
  rcRows: GrowthRcRow[];
  blended: BlendedRow[];
  /** first_seen per ad across the FULL 56d window (for "weeks on board"). */
  firstSeen: Map<string, string>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useGrowthData(): GrowthData {
  const [rows, setRows] = React.useState<GrowthAdRow[]>([]);
  const [rcRows, setRcRows] = React.useState<GrowthRcRow[]>([]);
  const [blended, setBlended] = React.useState<BlendedRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setError(null);
        const since = daysAgoISO(WINDOW_DAYS - 1);
        const until = utcDate(new Date());
        const [ads, rc, bl] = await Promise.all([
          sbSelect<GrowthAdRow>(
            `ad_insights_daily?select=${AD_COLS}&date=gte.${since}&date=lte.${until}&limit=20000`,
          ),
          sbSelect<GrowthRcRow>(
            `rc_account_metrics_daily?select=*&date=gte.${since}&date=lte.${until}&order=date.desc`,
          ),
          sbSelect<BlendedRow>(
            `blended_marketing_efficiency?select=*&order=date.desc&limit=30`,
          ),
        ]);
        if (!alive) return;
        setRows(ads);
        setRcRows(rc);
        setBlended(bl);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tick]);

  const firstSeen = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const x of rows) {
      const cur = m.get(x.ad_id);
      if (!cur || x.date < cur) m.set(x.ad_id, x.date);
    }
    return m;
  }, [rows]);

  const refresh = React.useCallback(() => {
    setLoading(true);
    setTick((t) => t + 1);
  }, []);

  return { rows, rcRows, blended, firstSeen, loading, error, refresh };
}

// --- window slicing helpers used by Overview + Leaderboard ------------------

export interface WindowSlices {
  cur: Map<string, AdAgg>;
  prev: Map<string, AdAgg>;
  curRows: GrowthAdRow[];
  since: string;
}

/** Slice the 56d row set into [current N days] and [previous N days] aggs. */
export function sliceWindows(rows: GrowthAdRow[], days: number): WindowSlices {
  const since = daysAgoISO(days - 1);
  const prevSince = daysAgoISO(days * 2 - 1);
  const curRows = rows.filter((x) => x.date >= since);
  const prevRows = rows.filter((x) => x.date >= prevSince && x.date < since);
  return { cur: aggregateAds(curRows), prev: aggregateAds(prevRows), curRows, since };
}

export type ShiftKind = "scaling" | "declining" | "new" | "paused";

export interface ShiftAd {
  agg: AdAgg;
  deltaPct: number | null;
}

export function classifyShifts(rows: GrowthAdRow[]): Record<ShiftKind, ShiftAd[]> {
  const { cur, prev, since } = sliceWindows(rows, 7);
  // True first appearance across the FULL row set — the window-sliced agg's
  // first_seen is always inside the window, which would flag every ad as new.
  const firstSeenAll = new Map<string, string>();
  for (const x of rows) {
    const c = firstSeenAll.get(x.ad_id);
    if (!c || x.date < c) firstSeenAll.set(x.ad_id, x.date);
  }
  const scaling: ShiftAd[] = [];
  const declining: ShiftAd[] = [];
  const fresh: ShiftAd[] = [];
  for (const a of cur.values()) {
    const p = prev.get(a.ad_id);
    if (!p) {
      const fs = firstSeenAll.get(a.ad_id) ?? a.first_seen;
      if (fs >= since) fresh.push({ agg: a, deltaPct: null });
      continue;
    }
    const deltaPct = p.spend > 0 ? ((a.spend - p.spend) / p.spend) * 100 : null;
    if (deltaPct != null && deltaPct >= 25 && a.spend >= 25) scaling.push({ agg: a, deltaPct });
    else if (deltaPct != null && deltaPct <= -25 && p.spend >= 25) declining.push({ agg: a, deltaPct });
  }
  // paused: any ad with spend in the last 14d whose latest status isn't ACTIVE
  const last14 = aggregateAds(rows.filter((x) => x.date >= daysAgoISO(13)));
  const paused: ShiftAd[] = [...last14.values()]
    .filter((a) => a.effective_status !== "ACTIVE" && a.spend > 0)
    .map((a) => ({ agg: a, deltaPct: null }));

  const bySpend = (x: ShiftAd[]) => x.sort((a, b) => b.agg.spend - a.agg.spend);
  return {
    scaling: bySpend(scaling),
    declining: bySpend(declining),
    new: bySpend(fresh),
    paused: bySpend(paused),
  };
}
