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
  message: string | null;
  headline: string | null;
}

export interface CreativeTag {
  ad_id: string;
  visual_format: string;
  messaging_theme: string;
  theme_description: string | null;
  audience: string | null;
  hook_type: string | null;
  confidence: number | null;
}

export interface MarketingAlert {
  id: string;
  alert_date: string;
  scope: string;
  campaign_id: string | null;
  campaign_name: string | null;
  metric: string;
  value: string | number | null;
  baseline: string | number | null;
  z: string | number | null;
  direction: "spike" | "drop";
  severity: "info" | "warn" | "critical";
  message: string;
}

export interface PaybackSummary {
  blended_cac_per_trial_35d: string | number | null;
  blended_cac_per_sub_35d: string | number | null;
  ltv_30d_per_payer: string | number | null;
  ltv30_to_cac: string | number | null;
  payback_verdict: string | null;
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
  "thumbnail_url,image_url,video_id,video_3sec_views,video_thruplays,message,headline";

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
  /** Motion-style AI tags keyed by ad_id (empty until the tagger runs). */
  tags: Map<string, CreativeTag>;
  /** Unresolved anomaly alerts from the last 7 days, severity-sorted. */
  alerts: MarketingAlert[];
  /** LTV:CAC payback snapshot (single row) or null. */
  payback: PaybackSummary | null;
  /** first_seen per ad across the FULL 56d window (for "weeks on board"). */
  firstSeen: Map<string, string>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warn: 1, info: 2 };

export function useGrowthData(): GrowthData {
  const [rows, setRows] = React.useState<GrowthAdRow[]>([]);
  const [rcRows, setRcRows] = React.useState<GrowthRcRow[]>([]);
  const [blended, setBlended] = React.useState<BlendedRow[]>([]);
  const [tags, setTags] = React.useState<Map<string, CreativeTag>>(new Map());
  const [alerts, setAlerts] = React.useState<MarketingAlert[]>([]);
  const [payback, setPayback] = React.useState<PaybackSummary | null>(null);
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
        // Tags / alerts / payback tables ship after the core ones — treat
        // their failures as soft (empty result) so the tab still renders
        // if the 0039 migration hasn't landed yet.
        const soft = <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);
        const [ads, rc, bl, tagRows, alertRows, paybackRows] = await Promise.all([
          sbSelect<GrowthAdRow>(
            `ad_insights_daily?select=${AD_COLS}&date=gte.${since}&date=lte.${until}&limit=20000`,
          ),
          sbSelect<GrowthRcRow>(
            `rc_account_metrics_daily?select=*&date=gte.${since}&date=lte.${until}&order=date.desc`,
          ),
          sbSelect<BlendedRow>(
            `blended_marketing_efficiency?select=*&order=date.desc&limit=30`,
          ),
          soft(
            sbSelect<CreativeTag>(
              `ad_creative_tags?select=ad_id,visual_format,messaging_theme,theme_description,audience,hook_type,confidence&limit=5000`,
            ),
          ),
          soft(
            sbSelect<MarketingAlert>(
              `marketing_alerts?select=*&alert_date=gte.${daysAgoISO(6)}&resolved_at=is.null&order=alert_date.desc&limit=30`,
            ),
          ),
          soft(sbSelect<PaybackSummary>(`payback_summary?select=*&limit=1`)),
        ]);
        if (!alive) return;
        setRows(ads);
        setRcRows(rc);
        setBlended(bl);
        setTags(new Map(tagRows.map((t) => [t.ad_id, t])));
        setAlerts(
          [...alertRows].sort(
            (a, b) =>
              (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3) ||
              (a.alert_date < b.alert_date ? 1 : -1),
          ),
        );
        setPayback(paybackRows[0] ?? null);
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

  return { rows, rcRows, blended, tags, alerts, payback, firstSeen, loading, error, refresh };
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

export type ShiftKind = "scaling" | "declining" | "fatiguing" | "new" | "paused";

export interface ShiftAd {
  agg: AdAgg;
  deltaPct: number | null;
  /** Short human note, e.g. "hook −31% WoW, spend flat" (fatigue only). */
  note?: string;
}

// --- fatigue detection -------------------------------------------------------
// An ad is "fatiguing" when it keeps delivering but attention decays:
//   (a) trailing-7d CTR or hook_rate ≤ 0.75× the prior 7d while spend held
//       (≥ 0.8× prior week), min 1,000 impressions in each week; or
//   (b) cost per trial rose two consecutive weeks (each week ≥ 1 trial).
// Only ACTIVE ads with ≥ $50 spend over the last 14d are considered.
// NOTE: mirrored server-side in src/lib/growth-tools.ts (fatigue_check tool)
// — keep the thresholds in sync.

export interface FatigueInfo {
  ad_id: string;
  note: string;
}

export function detectFatigue(rows: GrowthAdRow[]): Map<string, FatigueInfo> {
  const w0 = sliceWindows(rows, 7); // cur = last 7d, prev = 7d before
  const w2rows = rows.filter((x) => x.date >= daysAgoISO(20) && x.date < daysAgoISO(13));
  const w2 = aggregateAds(w2rows);
  const last14 = aggregateAds(rows.filter((x) => x.date >= daysAgoISO(13)));

  const out = new Map<string, FatigueInfo>();
  for (const cur of w0.cur.values()) {
    const base = last14.get(cur.ad_id);
    if (!base || base.effective_status !== "ACTIVE" || base.spend < 50) continue;
    const prev = w0.prev.get(cur.ad_id);

    // (a) attention decay while delivery holds
    if (prev && cur.impressions >= 1000 && prev.impressions >= 1000 && cur.spend >= prev.spend * 0.8) {
      const ctrCur = safeDiv(cur.clicks, cur.impressions);
      const ctrPrev = safeDiv(prev.clicks, prev.impressions);
      const hookCur = safeDiv(cur.v3, cur.impressions);
      const hookPrev = safeDiv(prev.v3, prev.impressions);
      const ctrDrop = Number.isFinite(ctrCur) && Number.isFinite(ctrPrev) && ctrPrev > 0 && ctrCur <= ctrPrev * 0.75;
      const hookDrop =
        Number.isFinite(hookCur) && Number.isFinite(hookPrev) && hookPrev > 0 && hookCur <= hookPrev * 0.75;
      if (ctrDrop || hookDrop) {
        const which = hookDrop ? "hook" : "CTR";
        const pct = hookDrop
          ? Math.round((hookCur / hookPrev - 1) * 100)
          : Math.round((ctrCur / ctrPrev - 1) * 100);
        out.set(cur.ad_id, {
          ad_id: cur.ad_id,
          note: `${which} ${pct}% WoW, spend held`,
        });
        continue;
      }
    }

    // (b) CPT rising two consecutive weeks
    const p1 = w0.prev.get(cur.ad_id);
    const p2 = w2.get(cur.ad_id);
    if (p1 && p2 && cur.trial_starts >= 1 && p1.trial_starts >= 1 && p2.trial_starts >= 1) {
      const c0 = cur.spend / cur.trial_starts;
      const c1 = p1.spend / p1.trial_starts;
      const c2 = p2.spend / p2.trial_starts;
      if (c0 > c1 && c1 > c2) {
        out.set(cur.ad_id, {
          ad_id: cur.ad_id,
          note: `CPT rising 2 wks ($${c2.toFixed(0)}→$${c1.toFixed(0)}→$${c0.toFixed(0)})`,
        });
      }
    }
  }
  return out;
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

  // fatiguing: attention decaying while delivery holds (see detectFatigue)
  const fatigue = detectFatigue(rows);
  const fatiguing: ShiftAd[] = [...cur.values()]
    .filter((a) => fatigue.has(a.ad_id))
    .map((a) => {
      const p = prev.get(a.ad_id);
      return {
        agg: a,
        deltaPct: p && p.spend > 0 ? ((a.spend - p.spend) / p.spend) * 100 : null,
        note: fatigue.get(a.ad_id)!.note,
      };
    });

  const bySpend = (x: ShiftAd[]) => x.sort((a, b) => b.agg.spend - a.agg.spend);
  return {
    scaling: bySpend(scaling),
    declining: bySpend(declining),
    fatiguing: bySpend(fatiguing),
    new: bySpend(fresh),
    paused: bySpend(paused),
  };
}
