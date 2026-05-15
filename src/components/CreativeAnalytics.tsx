"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { SUPABASE_URL, SUPABASE_ANON } from "@/lib/supabase";

const RANGES = ["1d", "7d", "14d", "30d"] as const;
type Range = (typeof RANGES)[number];

const ACCOUNT_ID =
  process.env.NEXT_PUBLIC_META_AD_ACCOUNT_ID ?? "act_1575502753719515";

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
  thumbnail_url: string;
  image_url: string;
  video_id: string;
  latest_date: string;
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
function paybackLabel(days: number): string {
  if (!Number.isFinite(days)) return "—";
  if (days > 999) return "999+ d";
  return `${Math.round(days)} d`;
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
        thumbnail_url: r.thumbnail_url ?? "",
        image_url: r.image_url ?? "",
        video_id: r.video_id ?? "",
        latest_date: r.date,
      };
      map.set(r.ad_id, a);
    }
    a.spend += Number(r.spend) || 0;
    a.impressions += Number(r.impressions) || 0;
    a.clicks += Number(r.clicks) || 0;
    a.installs += Number(r.installs) || 0;
    a.trial_starts += Number(r.trial_starts) || 0;
    a.purchases += Number(r.purchases) || 0;
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

export function CreativeAnalytics() {
  const [range, setRange] = React.useState<Range>("7d");
  const [campaignFilter, setCampaignFilter] = React.useState<string | null>(
    null,
  );
  const [insights, setInsights] = React.useState<InsightRow[]>([]);
  const [qualifiedRows, setQualifiedRows] = React.useState<QualifiedRow[]>([]);
  const [rcAccount, setRcAccount] = React.useState<RcAccountRow[]>([]);
  const [rcAds, setRcAds] = React.useState<RcAdRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const { since, until } = React.useMemo(() => dateWindow(range), [range]);

  const refresh = React.useCallback(async () => {
    setError(null);
    try {
      const [ins, q, rcAcc, rcAd] = await Promise.all([
        sbSelect<InsightRow>(
          `ad_insights_daily?select=*&date=gte.${since}&date=lte.${until}`,
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
      ]);
      setInsights(ins);
      setQualifiedRows(q);
      setRcAccount(rcAcc);
      setRcAds(rcAd);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [since, until]);

  React.useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  const ads = React.useMemo(
    () => aggregate(insights, campaignFilter),
    [insights, campaignFilter],
  );

  const totalSpend = ads.reduce((s, a) => s + a.spend, 0);
  const totalImpressions = ads.reduce((s, a) => s + a.impressions, 0);
  const totalClicks = ads.reduce((s, a) => s + a.clicks, 0);
  const totalInstalls = ads.reduce((s, a) => s + a.installs, 0);
  const totalTrialStarts = ads.reduce((s, a) => s + a.trial_starts, 0);
  const qualifiedCount = qualifiedRows.reduce(
    (s, r) => s + (r.count || 0),
    0,
  );
  const qualifiedRate = safeDiv(qualifiedCount, totalTrialStarts);
  const trueQualifiedCpa = safeDiv(totalSpend, qualifiedCount);
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
  // Daily revenue rate (window total / window days) → days-to-payback for total spend.
  const windowDays = Math.max(1, rcAccount.length || 1);
  const dailyRevenue = accountRevenue / windowDays;
  const blendedPaybackDays = safeDiv(totalSpend, dailyRevenue);
  const trialToPaidRate = safeDiv(accountTrialConversions, totalTrialStarts);

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

  if (loading) {
    return (
      <div style={{ padding: 80, textAlign: "center", color: "var(--ink-3)" }}>
        <div
          className="serif"
          style={{
            fontFamily: "var(--font-newsreader), serif",
            fontSize: 24,
            fontStyle: "italic",
          }}
        >
          Loading creatives…
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Admin · Paid Media"
        title={<em>Creatives</em>}
        subtitle={`Live ads from ${ACCOUNT_ID}. Joined with the n8n trial-qualified bridge. Window: ${since} → ${until} (UTC).`}
        tint="color-mix(in oklab, var(--p-andrea) 45%, transparent)"
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 999,
                border: "1px solid var(--line)",
                background: r === range ? "var(--ink)" : "var(--surface)",
                color: r === range ? "var(--surface)" : "var(--ink-2)",
              }}
            >
              {r}
            </button>
          ))}
        </div>
        {campaigns.length > 1 && (
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontFamily: "var(--font-geist-mono), monospace",
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                color: "var(--ink-3)",
              }}
            >
              Campaign
            </span>
            <button
              onClick={() => setCampaignFilter(null)}
              style={{
                padding: "4px 10px",
                fontSize: 12,
                borderRadius: 999,
                border: "1px solid var(--line)",
                background: !campaignFilter ? "var(--ink)" : "var(--surface)",
                color: !campaignFilter ? "var(--surface)" : "var(--ink-2)",
              }}
            >
              All
            </button>
            {campaigns.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setCampaignFilter(id)}
                title={id}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  borderRadius: 999,
                  border: "1px solid var(--line)",
                  background:
                    campaignFilter === id ? "var(--ink)" : "var(--surface)",
                  color:
                    campaignFilter === id ? "var(--surface)" : "var(--ink-2)",
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            marginBottom: 20,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--accent)",
            background:
              "color-mix(in oklab, var(--accent) 10%, var(--surface))",
            border:
              "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
            borderRadius: 10,
          }}
        >
          {error} — run the sync crons (`/api/cron/sync-ad-insights`,{" "}
          `/api/cron/sync-qualified-trials`) to populate data.
        </div>
      )}

      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-lg)",
          padding: 24,
          marginBottom: 16,
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <SectionLabel>Acquisition</SectionLabel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 24,
          }}
        >
          <Metric label="Spend" value={fmtUSD(totalSpend)} />
          <Metric label="Impressions" value={fmtInt(totalImpressions)} />
          <Metric label="CTR" value={fmtPct(accountCtr)} />
          <Metric label="Installs" value={fmtInt(totalInstalls)} />
          <Metric label="Trial starts" value={fmtInt(totalTrialStarts)} />
          <Metric label="Qualified trials" value={fmtInt(qualifiedCount)} />
          <Metric label="Qualified rate" value={fmtPct(qualifiedRate)} />
          <Metric
            label="True qualified CPA"
            value={fmtUSD(trueQualifiedCpa)}
            sub={`Reported: ${fmtUSD(reportedCpa)}`}
            accent
          />
        </div>
      </section>

      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--radius-lg)",
          padding: 24,
          marginBottom: 28,
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <SectionLabel>
          Money made{" "}
          <span
            style={{
              color: "var(--ink-4)",
              textTransform: "none",
              letterSpacing: "normal",
              fontFamily: "var(--font-geist), sans-serif",
              fontSize: 11,
              marginLeft: 8,
            }}
          >
            from RevenueCat · {windowDays}d window
          </span>
        </SectionLabel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 24,
          }}
        >
          <Metric label="Revenue" value={fmtUSD(accountRevenue)} />
          <Metric
            label="Trial → paid"
            value={fmtPct(trialToPaidRate)}
            sub={`${fmtInt(accountTrialConversions)} conversions`}
          />
          <Metric label="30d LTV / paid" value={fmtUSD(accountLtv30d)} />
          <Metric
            label="Blended ROAS"
            value={
              Number.isFinite(blendedRoas)
                ? `${blendedRoas.toFixed(2)}×`
                : "—"
            }
            accent
          />
          <Metric
            label="Blended payback"
            value={paybackLabel(blendedPaybackDays)}
            sub="days at current daily revenue"
          />
        </div>
      </section>

      {ads.length === 0 && !error && (
        <div
          style={{
            padding: 80,
            textAlign: "center",
            color: "var(--ink-3)",
            fontStyle: "italic",
            fontFamily: "var(--font-newsreader), serif",
            fontSize: 20,
          }}
        >
          No ads in this window. Run{" "}
          <code style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
            /api/cron/sync-ad-insights
          </code>{" "}
          to backfill.
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
            qualifiedRate={qualifiedRate}
            accountId={ACCOUNT_ID}
            totalSpend={totalSpend}
            accountRevenue={accountRevenue}
            accountLtv30d={accountLtv30d}
            rcAd={rcAdMap.get(a.ad_id) ?? null}
          />
        ))}
      </div>

      <p
        style={{
          marginTop: 28,
          fontSize: 12,
          color: "var(--ink-3)",
          fontStyle: "italic",
        }}
      >
        * Per-ad revenue, ROAS, and payback are blended estimates today
        (account rate × per-ad spend share). They become real per-ad
        measurements once iOS attribution lands — see{" "}
        <code style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
          docs/attribution-handoff.md
        </code>
        . Until then, use them for absolute magnitude only; ranking by
        reported CPA equals ranking by blended ROAS.
      </p>
    </>
  );
}

function Metric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: "var(--ink-3)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-newsreader), serif",
          fontSize: 28,
          fontWeight: 400,
          color: accent ? "var(--accent)" : "var(--ink)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function AdCard({
  ad,
  qualifiedRate,
  accountId,
  totalSpend,
  accountRevenue,
  accountLtv30d,
  rcAd,
}: {
  ad: AdAgg;
  qualifiedRate: number;
  accountId: string;
  totalSpend: number;
  accountRevenue: number;
  accountLtv30d: number;
  rcAd: { revenue: number; ltv: number; trialStarts: number } | null;
}) {
  const ctr = safeDiv(ad.clicks, ad.impressions);
  const estQualified = Number.isFinite(qualifiedRate)
    ? ad.trial_starts * qualifiedRate
    : NaN;
  const blendedCpa = safeDiv(ad.spend, estQualified);
  const reportedCpa = safeDiv(ad.spend, ad.trial_starts);
  const adsManager = `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${accountId.replace(/^act_/, "")}&selected_ad_ids=${ad.ad_id}`;

  // Per-ad money: prefer real RC attribution row when present; otherwise
  // blend by spend share. The per-card asterisk distinguishes the two.
  const hasRealAttribution = !!rcAd && rcAd.revenue > 0;
  const adRevenue = hasRealAttribution
    ? rcAd!.revenue
    : safeDiv(ad.spend * accountRevenue, totalSpend);
  const adRoas = safeDiv(adRevenue, ad.spend);
  // Days-to-payback at the LTV per paying customer × estimated paying-customer count.
  // Approximation: revenue / ad.spend = ROAS; payback ≈ ad.spend / (adRevenue / 28).
  const adDailyRevenue = adRevenue / 28;
  const adPayback = safeDiv(ad.spend, adDailyRevenue);
  void accountLtv30d; // reserved — used once attribution lands and we compute true LTV cohorts.
  const statusTone =
    ad.effective_status === "ACTIVE"
      ? "var(--accent-2)"
      : ad.effective_status === "PAUSED"
        ? "var(--ink-3)"
        : "var(--accent)";

  return (
    <article
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "5 / 6.24",
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
              fontSize: 12,
            }}
          >
            no thumbnail
          </div>
        )}
        {ad.video_id && (
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              padding: "3px 8px",
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 999,
              background: "rgba(26, 24, 22, 0.72)",
              color: "#fff",
              backdropFilter: "blur(4px)",
            }}
          >
            ▶ video
          </div>
        )}
        {ad.effective_status && (
          <div
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              padding: "3px 8px",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.06em",
              borderRadius: 999,
              background: "rgba(253, 251, 247, 0.92)",
              color: statusTone,
              border: `1px solid ${statusTone}`,
            }}
          >
            {ad.effective_status}
          </div>
        )}
      </div>

      <div
        style={{
          padding: "14px 14px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          flex: 1,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
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
              fontSize: 11,
              color: "var(--ink-3)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 2,
            }}
            title={ad.adset_name}
          >
            {ad.adset_name}
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
          <CardMetric label="Installs" value={fmtInt(ad.installs)} />
          <CardMetric label="Trials" value={fmtInt(ad.trial_starts)} />
          <CardMetric label="Est. qual.*" value={fmtInt(estQualified)} />
          <CardMetric
            label="Qual. CPA*"
            value={fmtUSD(blendedCpa)}
            sub={`Rep. ${fmtUSD(reportedCpa)}`}
          />
          <CardMetric
            label={hasRealAttribution ? "Revenue" : "Revenue*"}
            value={fmtUSD(adRevenue)}
          />
          <CardMetric
            label={hasRealAttribution ? "ROAS" : "ROAS*"}
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
          />
          <CardMetric
            label={hasRealAttribution ? "Payback" : "Payback*"}
            value={paybackLabel(adPayback)}
          />
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
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 500,
            borderRadius: 8,
            border: "1px solid var(--line)",
            background: "var(--surface-2)",
            color: "var(--ink-2)",
            textDecoration: "none",
          }}
        >
          Open in Ads Manager ↗
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
      ? "var(--accent-2)"
      : tone === "bad"
        ? "var(--accent)"
        : tone === "warn"
          ? "var(--ink-2)"
          : "var(--ink)";
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--ink-3)",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: valueColor,
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: "var(--ink-4)", marginTop: 1 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontFamily: "var(--font-geist-mono), monospace",
        textTransform: "uppercase",
        letterSpacing: "0.14em",
        color: "var(--ink-3)",
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}
