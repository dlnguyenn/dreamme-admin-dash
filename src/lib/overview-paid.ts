/**
 * The Overview's Paid section: today, yesterday, the same day last week and
 * the last 7 complete days, side by side.
 *
 * Sources, and why:
 *  - Spend, installs, Meta-reported trials: a LIVE Meta insights read
 *    (campaign level, one row per campaign-day). ad_insights_daily is only
 *    synced once a day at 07:00 UTC, so it can't show today, and yesterday's
 *    row is frozen at 3am even though Meta keeps adding late conversions.
 *    The ad account runs on America/New_York, the same day boundary as the
 *    rest of the Overview. If the live read fails, past days fall back to
 *    ad_insights_daily and today shows "—".
 *  - Trials: RevenueCat (rc_trial_starts_daily, Eastern days), the same
 *    number as the hero tile. This is the source of truth. Meta's count is
 *    shown next to it because it is what Meta optimizes on, but it claims
 *    view-through and organic trials, so it can exceed the real total.
 *  - Revenue: rc_events charges minus support refunds, the April Plan
 *    scorecard's definition (within 0.5% of RC "Revenue"), bucketed by
 *    Eastern day. Gross: before Apple/Google take their cut.
 */
import { resolveMetaToken } from "@/lib/meta-oauth";
import { fetchCharges } from "@/lib/revenue-plan/value-per-trial-data";
import { fetchRefunds } from "@/lib/revenue-plan/experiments-data";
import { easternDate, easternDateOffset } from "@/lib/socialViews";

const API_VERSION = process.env.META_API_VERSION ?? "v22.0";
/** Days back from today the panel needs: today (0) through 7 days ago. */
export const PAID_DAYS = 8;
const LIVE_TTL_MS = 60_000;

export interface PaidCounts {
  spend: number | null;
  installs: number | null;
  metaTrials: number | null;
}

export interface PaidDay extends PaidCounts {
  date: string;
  /** RevenueCat trial starts, every source. */
  trials: number | null;
  /** Gross revenue, net of refunds, before store fees. */
  revenue: number | null;
  /** spend / RevenueCat trials (all sources, so it flatters paid). */
  costPerTrial: number | null;
  /** spend / Meta-reported trials, what Ads Manager calls cost per trial. */
  metaCostPerTrial: number | null;
  cpi: number | null;
}

export interface PaidCampaign {
  id: string;
  name: string;
  today: PaidCounts;
  yesterday: PaidCounts;
  last7: PaidCounts;
}

export interface PaidDaily {
  today: PaidDay;
  yesterday: PaidDay;
  weekAgo: PaidDay;
  /** The 7 complete days, yesterday back to 7 days ago. */
  last7: PaidDay;
  campaigns: PaidCampaign[];
  /** "live" = Meta read just now; "synced" = ad_insights_daily fallback. */
  metaSource: "live" | "synced" | null;
  metaError: string | null;
  /** Revenue query failed; revenue cells read "—", not $0. */
  revenueError: string | null;
  fetchedAt: string;
}

/** One campaign-day from Meta (or one ad-day from the synced table). */
export interface MetaDayRow {
  date: string;
  campaignId: string;
  campaignName: string;
  spend: number;
  installs: number;
  metaTrials: number;
}

const ratio = (a: number | null, b: number | null) =>
  a != null && b != null && b > 0 ? a / b : null;

function sumCounts(rows: MetaDayRow[]): PaidCounts {
  return {
    spend: rows.reduce((s, r) => s + r.spend, 0),
    installs: rows.reduce((s, r) => s + r.installs, 0),
    metaTrials: rows.reduce((s, r) => s + r.metaTrials, 0),
  };
}

const UNKNOWN: PaidCounts = { spend: null, installs: null, metaTrials: null };

/**
 * Pure: assemble the panel from already-fetched rows. `meta` null means the
 * Meta read failed for that day range entirely (cells read "—"); a day that
 * is in range but has no rows had genuinely zero spend.
 */
export function buildPaidDaily(input: {
  todayDate: string;
  meta: MetaDayRow[] | null;
  /** Dates the meta rows actually cover; days outside it read "—". */
  metaDates: Set<string> | null;
  trialsByDay: Map<string, number> | null;
  revenueByDay: Map<string, number> | null;
  metaSource: PaidDaily["metaSource"];
  metaError: string | null;
  revenueError: string | null;
  now?: Date;
}): PaidDaily {
  const dayAt = (n: number) => {
    const d = new Date(`${input.todayDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const dates = Array.from({ length: PAID_DAYS }, (_, i) => dayAt(i));
  const covered = (d: string) => input.meta != null && (input.metaDates?.has(d) ?? false);

  const metaFor = (ds: string[]): PaidCounts => {
    if (!ds.every(covered)) return UNKNOWN;
    const set = new Set(ds);
    return sumCounts((input.meta ?? []).filter((r) => set.has(r.date)));
  };
  const sumMap = (m: Map<string, number> | null, ds: string[]) =>
    m == null ? null : ds.reduce((s, d) => s + (m.get(d) ?? 0), 0);

  const makeDay = (label: string, ds: string[]): PaidDay => {
    const c = metaFor(ds);
    const trials = sumMap(input.trialsByDay, ds);
    return {
      date: label,
      ...c,
      trials,
      revenue: sumMap(input.revenueByDay, ds),
      costPerTrial: ratio(c.spend, trials),
      metaCostPerTrial: ratio(c.spend, c.metaTrials),
      cpi: ratio(c.spend, c.installs),
    };
  };

  const complete = dates.slice(1); // yesterday .. 7 days ago

  // Campaigns: anything that spent in the window, biggest 7-day spend first.
  const byCampaign = new Map<string, MetaDayRow[]>();
  for (const r of input.meta ?? []) {
    const list = byCampaign.get(r.campaignId);
    if (list) list.push(r);
    else byCampaign.set(r.campaignId, [r]);
  }
  const campaigns: PaidCampaign[] = [...byCampaign.entries()]
    .map(([id, rows]) => {
      const pick = (ds: string[]) => {
        if (!ds.every(covered)) return UNKNOWN;
        const set = new Set(ds);
        return sumCounts(rows.filter((r) => set.has(r.date)));
      };
      return {
        id,
        name: rows[rows.length - 1].campaignName,
        today: pick([dates[0]]),
        yesterday: pick([dates[1]]),
        last7: pick(complete),
      };
    })
    .filter((c) => (c.last7.spend ?? 0) > 0 || (c.today.spend ?? 0) > 0)
    .sort((a, b) => (b.last7.spend ?? 0) - (a.last7.spend ?? 0));

  return {
    today: makeDay(dates[0], [dates[0]]),
    yesterday: makeDay(dates[1], [dates[1]]),
    weekAgo: makeDay(dates[7], [dates[7]]),
    last7: makeDay(`${complete[complete.length - 1]}..${complete[0]}`, complete),
    campaigns,
    metaSource: input.metaSource,
    metaError: input.metaError,
    revenueError: input.revenueError,
    fetchedAt: (input.now ?? new Date()).toISOString(),
  };
}

/** Pure: charges/refunds (UTC timestamps) into Eastern-day revenue. */
export function revenueByEasternDay(
  rows: { at: string; priceUsd: number }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const day = easternDate(new Date(r.at));
    out.set(day, (out.get(day) ?? 0) + r.priceUsd);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Meta live read

type Action = { action_type: string; value: string };
type InsightRow = {
  date_start?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  actions?: Action[];
  conversions?: Action[];
};

// Same action types as vendors/meta-ads.ts (the ad_insights_daily sync), so
// the live and synced numbers mean the same thing. start_trial_total already
// rolls up the channels; adding the per-channel keys would double count.
const INSTALL_TYPES = new Set(["mobile_app_install", "app_install"]);
const TRIAL_TYPES = new Set(["start_trial_total"]);
const sumOf = (list: Action[] | undefined, types: Set<string>) =>
  (list ?? []).reduce(
    (s, a) => s + (types.has(a.action_type) ? Number(a.value) || 0 : 0),
    0,
  );

let liveCache: { at: number; key: string; rows: MetaDayRow[] } | null = null;

async function fetchMetaLive(since: string, until: string): Promise<MetaDayRow[]> {
  const key = `${since}..${until}`;
  if (liveCache && liveCache.key === key && Date.now() - liveCache.at < LIVE_TTL_MS) {
    return liveCache.rows;
  }
  const meta = await resolveMetaToken();
  if (!meta) throw new Error("no Meta connection (reconnect on Integrations)");
  const account = meta.account.startsWith("act_") ? meta.account : `act_${meta.account}`;
  const qs = new URLSearchParams({
    level: "campaign",
    fields: "campaign_id,campaign_name,spend,actions,conversions",
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    limit: "500",
  });
  let next: string | null =
    `https://graph.facebook.com/${API_VERSION}/${account}/insights?${qs}`;
  const rows: MetaDayRow[] = [];
  for (let page = 0; next && page < 10; page++) {
    const res: Response = await fetch(next, {
      headers: { Authorization: `Bearer ${meta.token}` },
      cache: "no-store",
    });
    const body = (await res.json()) as {
      data?: InsightRow[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!res.ok || body.error) {
      throw new Error(`Meta ${res.status}: ${body.error?.message ?? "request failed"}`);
    }
    for (const r of body.data ?? []) {
      rows.push({
        date: String(r.date_start ?? ""),
        campaignId: String(r.campaign_id ?? ""),
        campaignName: String(r.campaign_name ?? ""),
        spend: Number(r.spend ?? 0) || 0,
        installs: sumOf(r.actions, INSTALL_TYPES),
        metaTrials: sumOf(r.conversions, TRIAL_TYPES),
      });
    }
    next = body.paging?.next ?? null;
  }
  liveCache = { at: Date.now(), key, rows };
  return rows;
}

// ---------------------------------------------------------------------------

export interface PaidDailyDeps {
  /** rc_trial_starts_daily rows the Overview already fetched; null = failed. */
  trialStarts: { date: string; trial_starts: number }[] | null;
  /** ad_insights_daily reader for the fallback path. */
  syncedInsights: (since: string) => Promise<
    { date: string; campaign_id: string | null; campaign_name: string | null; spend: number | null; installs: number | null; trial_starts: number | null }[]
  >;
}

export async function fetchPaidDaily(deps: PaidDailyDeps, now = new Date()): Promise<PaidDaily> {
  const todayDate = easternDate(now);
  const since = easternDateOffset(PAID_DAYS - 1, now);
  const allDates = Array.from({ length: PAID_DAYS }, (_, i) => easternDateOffset(i, now));

  let meta: MetaDayRow[] | null = null;
  let metaDates: Set<string> | null = null;
  let metaSource: PaidDaily["metaSource"] = null;
  let metaError: string | null = null;
  try {
    meta = await fetchMetaLive(since, todayDate);
    metaDates = new Set(allDates);
    metaSource = "live";
  } catch (e) {
    metaError = e instanceof Error ? e.message : String(e);
    try {
      const synced = await deps.syncedInsights(since);
      meta = synced.map((r) => ({
        date: r.date,
        campaignId: r.campaign_id ?? "unknown",
        campaignName: r.campaign_name ?? "Unknown campaign",
        spend: Number(r.spend) || 0,
        installs: Number(r.installs) || 0,
        metaTrials: Number(r.trial_starts) || 0,
      }));
      // The sync runs once a day, so today is never in it. A past day with no
      // rows at all is treated as not synced rather than as $0.
      metaDates = new Set(meta.filter((r) => r.date !== todayDate).map((r) => r.date));
      metaSource = "synced";
    } catch {
      meta = null;
    }
  }

  // Charges from 8 Eastern days back, with a day of slack for the UTC offset.
  const revenueSince = `${easternDateOffset(PAID_DAYS, now)}T00:00:00Z`;
  let revenueByDay: Map<string, number> | null = null;
  let revenueError: string | null = null;
  try {
    const [charges, refunds] = await Promise.all([
      fetchCharges(revenueSince),
      fetchRefunds(revenueSince),
    ]);
    revenueByDay = revenueByEasternDay([...charges, ...refunds]);
  } catch (e) {
    revenueError = e instanceof Error ? e.message : String(e);
  }

  const trialsByDay = deps.trialStarts
    ? new Map(deps.trialStarts.map((r) => [r.date, Number(r.trial_starts) || 0]))
    : null;

  return buildPaidDaily({
    todayDate,
    meta,
    metaDates,
    trialsByDay,
    revenueByDay,
    metaSource,
    metaError,
    revenueError,
    now,
  });
}
