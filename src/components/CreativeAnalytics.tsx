"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { Button } from "./ui";
import {
  ErrorBanner,
  FilterPill,
  InfoWell,
  SectionHeader,
  Segmented,
  StatStrip,
} from "./porcelain";
import { SUPABASE_URL, SUPABASE_ANON } from "@/lib/supabase";

const RANGES = ["1d", "7d", "14d", "30d"] as const;
type Range = (typeof RANGES)[number];

const PLATFORMS = ["meta", "tiktok"] as const;
type Platform = (typeof PLATFORMS)[number];

const ACCOUNT_ID =
  process.env.NEXT_PUBLIC_META_AD_ACCOUNT_ID ?? "act_1575502753719515";
// Spend threshold below which a day is treated as "no-paid baseline" for
// the incremental-lift card. $10 covers brand-protection / always-on tests
// without misclassifying real promo days.
const BASELINE_SPEND_THRESHOLD = 10;

interface InsightRow {
  ad_id: string;
  date: string;
  ad_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  status: string | null;
  effective_status: string | null;
  spend: string | number;
  impressions: number;
  clicks: number;
  unique_clicks: number;
  installs: number;
  trial_starts: number;
  purchases: number;
  purchase_value: string | number;
  creative_id: string | null;
  creative_name: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  video_id: string | null;
  message: string | null;
  headline: string | null;
  video_3sec_views: number | null;
  video_thruplays: number | null;
  synced_at: string;
}

interface QualifiedRow {
  date: string;
  count: number;
}

interface RcAccountRow {
  date: string;
  mrr: string | number | null;
  revenue: string | number | null;
  active_subscriptions: number | null;
  active_trials: number | null;
  new_customers: number | null;
  trial_starts: number | null;
  trial_conversions: number | null;
  trial_conversion_rate: string | number | null;
  ltv_30d_per_paying_customer: string | number | null;
}

interface RcAdRow {
  ad_id: string;
  date: string;
  trial_starts: number;
  trial_conversions: number;
  revenue_28d: string | number | null;
  ltv_30d: string | number | null;
}

interface TiktokRow {
  ad_id: string;
  date: string;
  ad_name: string | null;
  adgroup_id: string | null;
  adgroup_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  status: string | null;
  operation_status: string | null;
  spend: string | number;
  impressions: number;
  clicks: number;
  ctr: string | number | null;
  cpm: string | number | null;
  video_play_actions: number;
  video_views_p100: number;
  installs: number;
  trial_starts: number;
  purchases: number;
  purchase_value: string | number;
  is_spark_ad: boolean;
  spark_creator_username: string | null;
  spark_video_id: string | null;
  spark_video_url: string | null;
  thumbnail_url: string | null;
}

interface AdAgg {
  ad_id: string;
  ad_name: string;
  adset_id: string;
  adset_name: string;
  campaign_id: string;
  campaign_name: string;
  effective_status: string;
  spend: number;
  impressions: number;
  clicks: number;
  installs: number;
  trial_starts: number;
  purchases: number;
  video_3sec_views: number;
  video_thruplays: number;
  thumbnail_url: string;
  image_url: string;
  video_id: string;
  latest_date: string;
  // TikTok-only
  video_views_p100?: number;
  is_spark_ad?: boolean;
  spark_creator_username?: string;
  spark_video_url?: string;
  platform: Platform;
}

function fmtUSD(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: abs >= 100 ? 0 : 2,
  });
}
function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}
function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}
function safeDiv(a: number, b: number): number {
  return b > 0 ? a / b : NaN;
}
function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function dateWindow(range: Range): { since: string; until: string } {
  const days = Number(range.replace("d", ""));
  const today = new Date();
  const since = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { since: utcDate(since), until: utcDate(today) };
}

async function sbSelect<T>(path: string): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    throw new Error("Supabase not configured");
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Supabase read failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T[]>;
}

function aggregate(
  rows: InsightRow[],
  campaignFilter: string | null,
): AdAgg[] {
  const map = new Map<string, AdAgg>();
  for (const r of rows) {
    if (campaignFilter && r.campaign_id !== campaignFilter) continue;
    let a = map.get(r.ad_id);
    if (!a) {
      a = {
        ad_id: r.ad_id,
        ad_name: r.ad_name ?? "",
        adset_id: r.adset_id ?? "",
        adset_name: r.adset_name ?? "",
        campaign_id: r.campaign_id ?? "",
        campaign_name: r.campaign_name ?? "",
        effective_status: r.effective_status ?? "",
        spend: 0,
        impressions: 0,
        clicks: 0,
        installs: 0,
        trial_starts: 0,
        purchases: 0,
        video_3sec_views: 0,
        video_thruplays: 0,
        thumbnail_url: r.thumbnail_url ?? "",
        image_url: r.image_url ?? "",
        video_id: r.video_id ?? "",
        latest_date: r.date,
        platform: "meta",
      };
      map.set(r.ad_id, a);
    }
    a.spend += Number(r.spend) || 0;
    a.impressions += Number(r.impressions) || 0;
    a.clicks += Number(r.clicks) || 0;
    a.installs += Number(r.installs) || 0;
    a.trial_starts += Number(r.trial_starts) || 0;
    a.purchases += Number(r.purchases) || 0;
    a.video_3sec_views += Number(r.video_3sec_views) || 0;
    a.video_thruplays += Number(r.video_thruplays) || 0;
    if (r.date >= a.latest_date) {
      a.latest_date = r.date;
      if (r.ad_name) a.ad_name = r.ad_name;
      if (r.adset_name) a.adset_name = r.adset_name;
      if (r.campaign_name) a.campaign_name = r.campaign_name;
      if (r.effective_status) a.effective_status = r.effective_status;
      if (r.thumbnail_url) a.thumbnail_url = r.thumbnail_url;
      if (r.image_url) a.image_url = r.image_url;
      if (r.video_id) a.video_id = r.video_id;
    }
  }
  return [...map.values()].sort((a, b) => b.spend - a.spend);
}

function aggregateTiktok(
  rows: TiktokRow[],
  campaignFilter: string | null,
): AdAgg[] {
  const map = new Map<string, AdAgg>();
  for (const r of rows) {
    if (campaignFilter && r.campaign_id !== campaignFilter) continue;
    let a = map.get(r.ad_id);
    if (!a) {
      a = {
        ad_id: r.ad_id,
        ad_name: r.ad_name ?? "",
        adset_id: r.adgroup_id ?? "",
        adset_name: r.adgroup_name ?? "",
        campaign_id: r.campaign_id ?? "",
        campaign_name: r.campaign_name ?? "",
        effective_status: r.operation_status ?? r.status ?? "",
        spend: 0,
        impressions: 0,
        clicks: 0,
        installs: 0,
        trial_starts: 0,
        purchases: 0,
        video_3sec_views: 0,
        video_thruplays: 0,
        thumbnail_url: r.thumbnail_url ?? "",
        image_url: "",
        video_id: r.spark_video_id ?? "",
        latest_date: r.date,
        video_views_p100: 0,
        is_spark_ad: !!r.is_spark_ad,
        spark_creator_username: r.spark_creator_username ?? "",
        spark_video_url: r.spark_video_url ?? "",
        platform: "tiktok",
      };
      map.set(r.ad_id, a);
    }
    a.spend += Number(r.spend) || 0;
    a.impressions += Number(r.impressions) || 0;
    a.clicks += Number(r.clicks) || 0;
    a.installs += Number(r.installs) || 0;
    a.trial_starts += Number(r.trial_starts) || 0;
    a.purchases += Number(r.purchases) || 0;
    a.video_views_p100 = (a.video_views_p100 ?? 0) + (Number(r.video_views_p100) || 0);
    if (r.date >= a.latest_date) {
      a.latest_date = r.date;
      if (r.ad_name) a.ad_name = r.ad_name;
      if (r.adgroup_name) a.adset_name = r.adgroup_name;
      if (r.campaign_name) a.campaign_name = r.campaign_name;
      const status = r.operation_status ?? r.status ?? "";
      if (status) a.effective_status = status;
      if (r.thumbnail_url) a.thumbnail_url = r.thumbnail_url;
      a.is_spark_ad = !!r.is_spark_ad;
      if (r.spark_creator_username) a.spark_creator_username = r.spark_creator_username;
      if (r.spark_video_url) a.spark_video_url = r.spark_video_url;
    }
  }
  return [...map.values()].sort((a, b) => b.spend - a.spend);
}

export function CreativeAnalytics() {
  const [range, setRange] = React.useState<Range>("7d");
  const [platform, setPlatform] = React.useState<Platform>("meta");
  const [sortBy, setSortBy] = React.useState<"spend" | "hook">("spend");
  const [campaignFilter, setCampaignFilter] = React.useState<string | null>(
    null,
  );
  const [insights, setInsights] = React.useState<InsightRow[]>([]);
  const [tiktokInsights, setTiktokInsights] = React.useState<TiktokRow[]>([]);
  const [qualifiedRows, setQualifiedRows] = React.useState<QualifiedRow[]>([]);
  const [rcAccount, setRcAccount] = React.useState<RcAccountRow[]>([]);
  const [rcAds, setRcAds] = React.useState<RcAdRow[]>([]);
  // 60d window used to derive a baseline trial volume from low-spend days,
  // independent of the user-selected display window. Pulled from RC's
  // trial_starts (more reliable + longer history than the n8n bridge,
  // which only started firing reliably 2026-05-10).
  const [baselineHistory, setBaselineHistory] = React.useState<
    { date: string; meta_spend: number; trial_starts: number }[]
  >([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Reset campaign filter when switching platform — campaign IDs don't cross.
  React.useEffect(() => {
    setCampaignFilter(null);
  }, [platform]);

  const { since, until } = React.useMemo(() => dateWindow(range), [range]);

  // Wide 60d window for baseline computation (separate from display window).
  const baselineWindow = React.useMemo(() => {
    const today = new Date();
    const start = new Date(today.getTime() - 59 * 24 * 60 * 60 * 1000);
    return { since: utcDate(start), until: utcDate(today) };
  }, []);

  const refresh = React.useCallback(async () => {
    setError(null);
    try {
      const [ins, tt, q, rcAcc, rcAd, baseMeta, baseTrials] = await Promise.all([
        sbSelect<InsightRow>(
          `ad_insights_daily?select=*&date=gte.${since}&date=lte.${until}`,
        ),
        sbSelect<TiktokRow>(
          `tiktok_ad_insights_daily?select=*&date=gte.${since}&date=lte.${until}`,
        ),
        sbSelect<QualifiedRow>(
          `qualified_trials_daily?select=date,count&date=gte.${since}&date=lte.${until}`,
        ),
        sbSelect<RcAccountRow>(
          `rc_account_metrics_daily?select=*&date=gte.${since}&date=lte.${until}`,
        ),
        sbSelect<RcAdRow>(
          `rc_ad_metrics_daily?select=*&date=gte.${since}&date=lte.${until}`,
        ),
        // Baseline pull: 60d of Meta spend-per-day + 60d of RC trial_starts,
        // joined client-side. RC trials go back further than the n8n bridge.
        sbSelect<{ date: string; spend: string | number }>(
          `ad_insights_daily?select=date,spend&date=gte.${baselineWindow.since}&date=lte.${baselineWindow.until}`,
        ),
        sbSelect<{ date: string; trial_starts: number }>(
          `rc_account_metrics_daily?select=date,trial_starts&date=gte.${baselineWindow.since}&date=lte.${baselineWindow.until}`,
        ),
      ]);
      setInsights(ins);
      setTiktokInsights(tt);
      setQualifiedRows(q);
      setRcAccount(rcAcc);
      setRcAds(rcAd);

      // Build baseline history map: per-date Meta spend + RC trial_starts.
      const metaByDate = new Map<string, number>();
      for (const r of baseMeta) {
        metaByDate.set(
          r.date,
          (metaByDate.get(r.date) ?? 0) + (Number(r.spend) || 0),
        );
      }
      const history: { date: string; meta_spend: number; trial_starts: number }[] =
        baseTrials.map((r) => ({
          date: r.date,
          meta_spend: metaByDate.get(r.date) ?? 0,
          trial_starts: Number(r.trial_starts) || 0,
        }));
      setBaselineHistory(history);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [since, until, baselineWindow.since, baselineWindow.until]);

  React.useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  const ads = React.useMemo(() => {
    const base =
      platform === "meta"
        ? aggregate(insights, campaignFilter)
        : aggregateTiktok(tiktokInsights, campaignFilter);
    if (sortBy === "hook") {
      const hookOf = (a: AdAgg) =>
        a.impressions > 0 ? a.video_3sec_views / a.impressions : 0;
      return [...base].sort((a, b) => hookOf(b) - hookOf(a));
    }
    return base;
  }, [platform, insights, tiktokInsights, campaignFilter, sortBy]);

  // Incremental-lift baseline: avg trials/day on days where Meta spend < $10.
  // Drop the leading dates that are all zero (n8n bridge wasn't firing
  // pre-5/10/2026) so the baseline isn't artificially deflated.
  const baseline = React.useMemo(() => {
    const lowSpendDays = baselineHistory.filter(
      (d) => d.meta_spend < BASELINE_SPEND_THRESHOLD && d.trial_starts > 0,
    );
    if (!lowSpendDays.length) {
      return { perDay: 0, sampleDays: 0 };
    }
    const total = lowSpendDays.reduce((s, d) => s + d.trial_starts, 0);
    return { perDay: total / lowSpendDays.length, sampleDays: lowSpendDays.length };
  }, [baselineHistory]);

  const totalSpend = ads.reduce((s, a) => s + a.spend, 0);
  const totalImpressions = ads.reduce((s, a) => s + a.impressions, 0);
  const totalClicks = ads.reduce((s, a) => s + a.clicks, 0);
  const totalInstalls = ads.reduce((s, a) => s + a.installs, 0);
  const totalTrialStarts = ads.reduce((s, a) => s + a.trial_starts, 0);
  const totalVideo3sec = ads.reduce((s, a) => s + (a.video_3sec_views || 0), 0);
  const accountHookRate = safeDiv(totalVideo3sec, totalImpressions);
  const qualifiedCount = qualifiedRows.reduce(
    (s, r) => s + (r.count || 0),
    0,
  );
  // qualifiedRate / trueQualifiedCpa intentionally removed: n8n fires for ALL
  // trials (paid + organic) while totalTrialStarts is Meta-SDK-only, so the
  // ratio is mismatched and produces nonsense numbers (e.g. 1625%). Bring
  // these back once iOS attribution lands so the n8n count can be Meta-filtered.
  const reportedCpa = safeDiv(totalSpend, totalTrialStarts);
  const accountCtr = safeDiv(totalClicks, totalImpressions);

  // Account-level revenue / LTV / ROAS from RevenueCat. Window matches the
  // selected range so apples-to-apples vs spend.
  const accountRevenue = rcAccount.reduce(
    (s, r) => s + (Number(r.revenue) || 0),
    0,
  );
  const accountTrialConversions = rcAccount.reduce(
    (s, r) => s + (Number(r.trial_conversions) || 0),
    0,
  );
  // Average across daily LTV samples (RC reports it per-day for the cohort
  // that converted that day; mean is the simplest stable summary).
  const ltvSamples = rcAccount
    .map((r) => Number(r.ltv_30d_per_paying_customer))
    .filter((n) => Number.isFinite(n) && n > 0);
  const accountLtv30d =
    ltvSamples.length > 0
      ? ltvSamples.reduce((s, n) => s + n, 0) / ltvSamples.length
      : NaN;
  const blendedRoas = safeDiv(accountRevenue, totalSpend);
  const windowDays = Math.max(1, rcAccount.length || 1);
  // Trial→paid uses the account-wide n8n trial count as the denominator so
  // both sides are account-scope. (Conversions are also account-scope.)
  const trialToPaidRate = safeDiv(accountTrialConversions, qualifiedCount);

  // Incremental lift: use RC trial_starts as the observed count (more
  // reliable than n8n bridge which has a 5/10 cutoff and may miss events).
  const windowRcTrials = rcAccount.reduce(
    (s, r) => s + (Number(r.trial_starts) || 0),
    0,
  );
  const windowDaysForLift = Math.max(1, rcAccount.length || windowDays);
  const expectedBaselineTrials = baseline.perDay * windowDaysForLift;
  const incrementalTrials = windowRcTrials - expectedBaselineTrials;
  const liftRatio = safeDiv(incrementalTrials, expectedBaselineTrials);
  const costPerIncrementalTrial = safeDiv(totalSpend, incrementalTrials);
  // Sample-size confidence — fewer than 3 zero-spend days = wide error bars.
  const baselineConfidence: "low" | "med" | "high" =
    baseline.sampleDays >= 7
      ? "high"
      : baseline.sampleDays >= 3
        ? "med"
        : "low";

  // Per-ad attribution lookup. Today this is empty for everyone; once iOS
  // attribution wires up, ad_id → real per-ad LTV/revenue starts populating.
  const rcAdMap = React.useMemo(() => {
    const m = new Map<string, { revenue: number; ltv: number; trialStarts: number }>();
    for (const r of rcAds) {
      const cur = m.get(r.ad_id) ?? { revenue: 0, ltv: 0, trialStarts: 0 };
      cur.revenue += Number(r.revenue_28d) || 0;
      const ltv = Number(r.ltv_30d);
      if (Number.isFinite(ltv) && ltv > 0) cur.ltv = ltv;
      cur.trialStarts += Number(r.trial_starts) || 0;
      m.set(r.ad_id, cur);
    }
    return m;
  }, [rcAds]);

  const campaigns = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const r of insights) {
      if (r.campaign_id) m.set(r.campaign_id, r.campaign_name ?? r.campaign_id);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [insights]);

  const metaAdCount = React.useMemo(
    () => new Set(insights.map((r) => r.ad_id)).size,
    [insights],
  );
  const tiktokAdCount = React.useMemo(
    () => new Set(tiktokInsights.map((r) => r.ad_id)).size,
    [tiktokInsights],
  );

  if (loading) {
    return (
      <div
        style={{
          padding: 80,
          textAlign: "center",
          font: "400 14px var(--font-ui)",
          color: "var(--ink-3)",
        }}
      >
        Loading creatives…
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Admin / Paid social"
        title="Creatives"
        subtitle={`Live ads from ${ACCOUNT_ID}. Joined with the n8n trial-qualified bridge. Window: ${since} → ${until} (UTC).`}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSortBy(sortBy === "spend" ? "hook" : "spend")}
            title="Toggle sort order"
          >
            Sort: {sortBy === "spend" ? "Spend" : "Hook rate"} ▾
          </Button>
        }
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 22,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <FilterPill
            label="Meta"
            count={metaAdCount || undefined}
            selected={platform === "meta"}
            onClick={() => setPlatform("meta")}
          />
          <FilterPill
            label="TikTok"
            count={tiktokAdCount || undefined}
            selected={platform === "tiktok"}
            onClick={() => setPlatform("tiktok")}
          />
        </div>
        <Segmented
          size="sm"
          options={RANGES.map((r) => ({ value: r, label: r }))}
          value={range}
          onChange={(v) => setRange(v as Range)}
        />
        {campaigns.length > 1 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <FilterPill
              label="All campaigns"
              selected={!campaignFilter}
              onClick={() => setCampaignFilter(null)}
            />
            {campaigns.map(([id, label]) => (
              <FilterPill
                key={id}
                label={
                  <span
                    title={id}
                    style={{
                      display: "inline-block",
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      verticalAlign: "bottom",
                    }}
                  >
                    {label}
                  </span>
                }
                selected={campaignFilter === id}
                onClick={() => setCampaignFilter(id)}
              />
            ))}
          </div>
        )}
      </div>

      {error && (
        <ErrorBanner>
          {error} — run the sync crons (`/api/cron/sync-ad-insights`,{" "}
          `/api/cron/sync-qualified-trials`) to populate data.
        </ErrorBanner>
      )}

      <InfoWell style={{ marginBottom: 16 }}>
        <strong style={{ color: "var(--ink-2)" }}>
          Heads up — Meta is a small share of installs.
        </strong>{" "}
        Most revenue is organic (TikTok), so account-wide ROAS overstates
        Meta-isolated ROAS. Per-ad revenue/payback aren&apos;t computable
        until iOS attribution wires up — see{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>
          docs/attribution-handoff.md
        </code>
        .
      </InfoWell>

      <SectionHeader
        family="accent"
        icon="Chart"
        title={`${platform === "meta" ? "Meta" : "TikTok"} acquisition`}
        meta="This window"
        style={{ margin: "26px 0 12px" }}
      />
      <StatStrip
        minColWidth={150}
        stats={[
          { label: "Spend", value: fmtUSD(totalSpend) },
          { label: "Impressions", value: fmtInt(totalImpressions) },
          { label: "CTR", value: fmtPct(accountCtr) },
          ...(platform === "meta"
            ? [
                {
                  label: "Hook rate",
                  value: fmtPct(accountHookRate),
                  note: "3-sec views ÷ impr.",
                },
              ]
            : []),
          { label: "Installs", value: fmtInt(totalInstalls) },
          {
            label: "Trial starts",
            value: fmtInt(totalTrialStarts),
            note:
              platform === "meta"
                ? "Meta SDK in-app event"
                : "TikTok start_trial event",
          },
          {
            label: "Reported trial CPA",
            value: fmtUSD(reportedCpa),
            note: "spend ÷ trial starts",
          },
        ]}
      />

      <SectionHeader
        family="warning"
        icon="Trend"
        title="Incremental lift"
        meta={`${platform} spend vs organic baseline`}
        right={
          <span
            style={{
              font: "400 12px var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              color:
                baselineConfidence === "low"
                  ? "var(--warning-text)"
                  : "var(--ink-3)",
            }}
          >
            baseline = {baseline.sampleDays} day
            {baseline.sampleDays === 1 ? "" : "s"} of $&lt;
            {BASELINE_SPEND_THRESHOLD}/d spend · {baselineConfidence} confidence
          </span>
        }
      />
      <StatStrip
        minColWidth={150}
        stats={[
          {
            label: "Baseline (organic)",
            value: fmtInt(expectedBaselineTrials),
            note: `${baseline.perDay.toFixed(1)} trials/day expected`,
          },
          {
            label: "Observed trials",
            value: fmtInt(windowRcTrials),
            note: "RC · all sources",
          },
          {
            label: "Above baseline",
            value: fmtInt(incrementalTrials),
            note: `${incrementalTrials >= 0 ? "+" : ""}${fmtInt(incrementalTrials)} vs expected`,
          },
          {
            label: "Lift over baseline",
            value: fmtPct(liftRatio),
            note: "(observed − baseline) ÷ baseline",
          },
          {
            label: "Cost per incremental",
            value: fmtUSD(costPerIncrementalTrial),
            note: `${fmtUSD(totalSpend)} ÷ ${fmtInt(incrementalTrials)} extra trials`,
          },
        ]}
      />
      {baselineConfidence === "low" && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            font: "400 12.5px/1.55 var(--font-ui)",
            color: "var(--warning-text)",
            background: "var(--warning-soft)",
            borderRadius: 10,
          }}
        >
          <strong>
            Low confidence — baseline computed from{" "}
            {baseline.sampleDays === 0 ? "no" : `only ${baseline.sampleDays}`}{" "}
            zero-spend day{baseline.sampleDays === 1 ? "" : "s"}.
          </strong>{" "}
          Meta has been running continuously, so we can&apos;t isolate
          organic trial volume. To establish a real baseline: pause Meta
          for 3–5 consecutive days. The dashboard auto-detects the
          zero-spend window and recomputes.
        </div>
      )}
      <InfoWell style={{ marginTop: 12 }}>
        Baseline assumes organic trial volume stays steady. Trustworthy at
        window ≥ 14d AND baseline sample ≥ 7 days. Negative lift = paid
        window underperformed your typical organic day (could be
        seasonality rather than bad ads). Observed trials come from
        RevenueCat (all sources).
      </InfoWell>

      <SectionHeader
        family="success"
        icon="Dollar"
        title="Account revenue"
        meta={`RevenueCat · ${windowDays}d window · includes organic`}
      />
      <div style={{ marginBottom: 28 }}>
        <StatStrip
          minColWidth={150}
          stats={[
            { label: "Revenue", value: fmtUSD(accountRevenue) },
            {
              label: "Trials (account)",
              value: fmtInt(qualifiedCount),
              note: "n8n bridge · all sources",
            },
            {
              label: "Trial → paid",
              value: fmtPct(trialToPaidRate),
              note: `${fmtInt(accountTrialConversions)} conversions`,
            },
            { label: "30d LTV / paid", value: fmtUSD(accountLtv30d) },
            {
              label: "Account ROAS",
              value: Number.isFinite(blendedRoas)
                ? `${blendedRoas.toFixed(2)}×`
                : "—",
              note: "all revenue ÷ Meta spend · inflated",
            },
          ]}
        />
      </div>

      {ads.length === 0 && !error && (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            border: "1px dashed var(--line-2)",
            borderRadius: 16,
            background: "var(--surface)",
            font: "400 13px/1.6 var(--font-ui)",
            color: "var(--ink-3)",
          }}
        >
          {platform === "meta" ? (
            <>
              No Meta ads in this window. Run{" "}
              <code style={{ fontFamily: "var(--font-mono)" }}>
                /api/cron/sync-ad-insights
              </code>{" "}
              to backfill.
            </>
          ) : (
            <>
              No TikTok ads in this window yet. Once you run Spark Ads, hit{" "}
              <code style={{ fontFamily: "var(--font-mono)" }}>
                /api/cron/sync-tiktok-ads
              </code>{" "}
              (see <code style={{ fontFamily: "var(--font-mono)" }}>docs/tiktok-ads-api-setup.md</code>).
            </>
          )}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 18,
        }}
      >
        {ads.map((a) => (
          <AdCard
            key={a.ad_id}
            ad={a}
            accountId={ACCOUNT_ID}
            totalSpend={totalSpend}
            accountRevenue={accountRevenue}
            accountLtv30d={accountLtv30d}
            rcAd={rcAdMap.get(a.ad_id) ?? null}
          />
        ))}
      </div>

      <InfoWell style={{ marginTop: 28 }}>
        <strong style={{ color: "var(--ink-2)" }}>Notes on the numbers.</strong>{" "}
        Trial starts and Reported CPA are Meta-SDK in-platform signals only
        (the iOS SDK fires{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>
          fb_mobile_complete_registration
        </code>{" "}
        for users it attributes back to a Meta ad). Trials (account) and
        Account ROAS include organic traffic (TikTok, ASA, word-of-mouth)
        and are NOT Meta-isolated — useful as a macro signal of overall app
        health, not as a measure of Meta ad performance. Per-ad ROAS will
        light up once{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>
          Purchases.shared.attribution.setAd(...)
        </code>{" "}
        is wired in iOS (see{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>
          docs/attribution-handoff.md
        </code>
        ).
      </InfoWell>
    </>
  );
}

function AdCard({
  ad,
  accountId,
  totalSpend,
  accountRevenue,
  accountLtv30d,
  rcAd,
}: {
  ad: AdAgg;
  accountId: string;
  totalSpend: number;
  accountRevenue: number;
  accountLtv30d: number;
  rcAd: { revenue: number; ltv: number; trialStarts: number } | null;
}) {
  const ctr = safeDiv(ad.clicks, ad.impressions);
  const hookRate = safeDiv(ad.video_3sec_views, ad.impressions);
  const reportedCpa = safeDiv(ad.spend, ad.trial_starts);
  const adsManager =
    ad.platform === "meta"
      ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${accountId.replace(/^act_/, "")}&selected_ad_ids=${ad.ad_id}`
      : `https://ads.tiktok.com/i18n/perf?aadvid=${process.env.NEXT_PUBLIC_TIKTOK_ADVERTISER_ID ?? ""}&search_ids=${ad.ad_id}`;
  const adsManagerLabel =
    ad.platform === "meta" ? "Open in Ads Manager" : "Open in TikTok Ads Manager";

  // Real per-ad ROAS only renders once iOS attribution lands. Until then,
  // blending by spend share at <30% Meta install share would lie loudly —
  // better to show "—" with a clear "needs attribution" caption.
  const hasRealAttribution = !!rcAd && rcAd.revenue > 0;
  const adRevenue = hasRealAttribution ? rcAd!.revenue : NaN;
  const adRoas = safeDiv(adRevenue, ad.spend);
  void accountLtv30d;
  void accountRevenue;
  void totalSpend;
  // Performance chip: soft-success for running ads, neutral for paused,
  // danger-soft for anything else Meta flags (rejected/with-issues…).
  const isRunning =
    ad.effective_status === "ACTIVE" || ad.effective_status === "ENABLE";
  const isPaused =
    ad.effective_status === "PAUSED" || ad.effective_status === "DISABLE";
  const chipBg = isRunning
    ? "var(--success-soft)"
    : isPaused
      ? "var(--neutral-soft)"
      : "var(--danger-soft)";
  const chipFg = isRunning
    ? "var(--success-text)"
    : isPaused
      ? "var(--neutral-text)"
      : "var(--danger-text)";

  return (
    <article
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: 200,
          borderRadius: 10,
          background: "var(--surface-2)",
          overflow: "hidden",
        }}
      >
        {ad.thumbnail_url || ad.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.image_url || ad.thumbnail_url}
            alt={ad.ad_name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-4)",
              font: "400 12px var(--font-ui)",
            }}
          >
            no thumbnail
          </div>
        )}
        {ad.is_spark_ad && ad.spark_video_url ? (
          <a
            href={ad.spark_video_url}
            target="_blank"
            rel="noreferrer"
            style={{
              position: "absolute",
              bottom: 8,
              left: 8,
              padding: "2.5px 8px",
              font: "650 10.5px var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              borderRadius: 999,
              background: "rgba(29,29,31,0.72)",
              color: "#F5F5F7",
              textDecoration: "none",
            }}
            title="Open the original TikTok post"
          >
            ⚡ SPARK · @{ad.spark_creator_username || "creator"}
          </a>
        ) : ad.video_id ? (
          <div
            style={{
              position: "absolute",
              bottom: 8,
              left: 8,
              padding: "2.5px 8px",
              font: "650 10.5px var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              borderRadius: 999,
              background: "rgba(29,29,31,0.72)",
              color: "#F5F5F7",
            }}
          >
            ▶ video
          </div>
        ) : null}
        {ad.effective_status && (
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              padding: "3px 9px",
              font: "700 12px var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              borderRadius: 99,
              background: chipBg,
              color: chipFg,
              boxShadow: "var(--shadow-xs)",
            }}
          >
            {ad.effective_status}
          </div>
        )}
      </div>

      <div
        style={{
          padding: "10px 8px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          flex: 1,
        }}
      >
        <div>
          <div
            style={{
              font: "600 13px var(--font-ui)",
              color: "var(--ink)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={ad.ad_name}
          >
            {ad.ad_name || ad.ad_id}
          </div>
          <div
            style={{
              font: "400 12px var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              color: "var(--ink-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 2,
            }}
            title={ad.adset_name}
          >
            {fmtUSD(ad.spend)} · {fmtInt(ad.trial_starts)} trials ·{" "}
            {ad.effective_status || "—"}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 8,
            paddingTop: 8,
            borderTop: "1px solid var(--line)",
          }}
        >
          <CardMetric label="Spend" value={fmtUSD(ad.spend)} />
          <CardMetric label="CTR" value={fmtPct(ctr)} />
          {ad.platform === "meta" && (
            <CardMetric
              label="Hook"
              value={fmtPct(hookRate)}
              tone={
                !Number.isFinite(hookRate)
                  ? undefined
                  : hookRate >= 0.3
                    ? "good"
                    : hookRate >= 0.2
                      ? "warn"
                      : "bad"
              }
            />
          )}
          <CardMetric label="Installs" value={fmtInt(ad.installs)} />
          <CardMetric label="Trials" value={fmtInt(ad.trial_starts)} />
          <CardMetric
            label="Reported CPA"
            value={fmtUSD(reportedCpa)}
          />
          {hasRealAttribution ? (
            <CardMetric
              label="ROAS"
              value={
                Number.isFinite(adRoas) ? `${adRoas.toFixed(2)}×` : "—"
              }
              tone={
                !Number.isFinite(adRoas)
                  ? undefined
                  : adRoas >= 1
                    ? "good"
                    : adRoas >= 0.5
                      ? "warn"
                      : "bad"
              }
              sub={fmtUSD(adRevenue)}
            />
          ) : (
            <CardMetric
              label="ROAS"
              value="—"
              sub="needs attribution"
            />
          )}
        </div>

        <a
          href={adsManager}
          target="_blank"
          rel="noreferrer"
          style={{
            marginTop: "auto",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "8px 12px",
            font: "600 12px var(--font-ui)",
            borderRadius: 10,
            border: "1px solid var(--line-2)",
            background: "var(--surface)",
            color: "var(--ink)",
            boxShadow: "var(--shadow-xs)",
            textDecoration: "none",
          }}
        >
          {adsManagerLabel} ↗
        </a>
      </div>
    </article>
  );
}

function CardMetric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "warn" | "bad";
}) {
  const valueColor =
    tone === "good"
      ? "var(--success-text)"
      : tone === "bad"
        ? "var(--danger-text)"
        : tone === "warn"
          ? "var(--warning-text)"
          : "var(--ink)";
  return (
    <div>
      <div
        style={{
          font: "650 10px var(--font-ui)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--ink-3)",
          marginBottom: 2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      <div
        style={{
          font: "600 13.5px var(--font-ui)",
          fontVariantNumeric: "tabular-nums",
          color: valueColor,
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            font: "400 10.5px var(--font-ui)",
            fontVariantNumeric: "tabular-nums",
            color: "var(--ink-4)",
            marginTop: 1,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
