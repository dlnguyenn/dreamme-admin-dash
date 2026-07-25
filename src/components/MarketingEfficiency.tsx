"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { PricingExperiments } from "./PricingExperiments";
import { Button } from "./ui";
import { Icons } from "./Icons";
import {
  Card,
  DeltaChip,
  ErrorBanner,
  HeroCard,
  InfoWell,
  KpiCard,
  SectionHeader,
  SeverityTile,
  StatusPill,
  StatStrip,
  severityTextColor,
  thStyle,
  type Severity,
} from "./porcelain";
import { API } from "@/lib/supabase";
import type {
  BlendedEfficiencyRow,
  CampaignLtvCohortRow,
  CrossNetworkBlendedRow,
  CrossNetworkCampaignRow,
  MarketingAlertRow,
  PaybackSummaryRow,
  PayerRetentionCohortRow,
  SkanCampaignEfficiencyRow,
  SkanHealthRow,
  SkanReconciliationRow,
} from "@/lib/types";

// PostgREST returns numeric columns as strings — coerce defensively.
const num = (v: string | number | null | undefined): number =>
  v == null ? 0 : typeof v === "number" ? v : Number(v) || 0;

function fmtUSD(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  const abs = Math.abs(n);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: abs >= 100 ? 0 : 2,
  });
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Whole days from today (UTC) until an ISO date; negative once the date passes.
function daysUntil(iso: string): number {
  const target = new Date(`${iso}T00:00:00Z`).getTime();
  const now = Date.now();
  return Math.ceil((target - now) / 86_400_000);
}

interface ExperimentStat {
  label: string;
  value: string;
  sub?: string;
  tone?: "success" | "danger";
}

interface DashExperiment {
  id: string;
  title: string;
  change: string;
  startedISO: string;
  readISO: string;
  stats: ExperimentStat[];
  file: string;
}

// Hand-maintained for now — one card per live paid-ads experiment. When this
// grows past a handful, promote to a `marketing_experiments` Supabase table and
// fetch it like the rest of the page. Full protocol for each lives in the repo
// at the `file` path below.
const EXPERIMENTS: DashExperiment[] = [
  {
    id: "comic-sans-budget-scale",
    title: "Comic Sans budget scale",
    change: "$150 → $225/day (+50%)",
    startedISO: "2026-06-11",
    readISO: "2026-06-20",
    stats: [
      { label: "Baseline CPI", value: "$2.65", sub: "· 400 installs/wk" },
      { label: "Frequency", value: "1.35" },
      { label: "Win if CPI holds", value: "≤ $3.20", tone: "success" },
      { label: "Fail → revert to $150", value: "> $3.45", tone: "danger" },
    ],
    file: "experiments/2026-06-11-comic-sans-budget-scale.md",
  },
];

// Delta vs a prior value, rendered "↑ 12%" / "↓ 24%".
function pctDelta(cur: number, prev: number): string | null {
  if (!prev) return null;
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(d)) return null;
  const arrow = d >= 0 ? "↑" : "↓";
  return `${arrow} ${Math.abs(d).toFixed(0)}%`;
}

export function MarketingEfficiency() {
  const [rows, setRows] = React.useState<BlendedEfficiencyRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setError(null);
      const data = await API.fetchBlendedEfficiency(90);
      setRows(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div
        style={{
          padding: 80,
          textAlign: "center",
          color: "var(--ink-3)",
          font: "400 14px var(--font-ui)",
        }}
      >
        Loading efficiency…
      </div>
    );
  }

  const latest = rows[0];
  const weekAgo = rows[7];
  // Rows arrive newest-first; sampling every 7th gives a clean ~weekly trend.
  const weekly = rows.filter((_, i) => i % 7 === 0).slice(0, 10);
  // Chronological last ~4 weeks for the KPI sparklines.
  const sparkRows = rows.slice(0, 28).slice().reverse();
  const sparkOf = (pick: (r: BlendedEfficiencyRow) => number) =>
    sparkRows.map(pick);

  const merDelta =
    latest && weekAgo ? num(latest.mer_7d) - num(weekAgo.mer_7d) : null;

  const kpi = (
    pick: (r: BlendedEfficiencyRow) => number,
  ): { delta: string | null; up: boolean } => {
    if (!latest || !weekAgo) return { delta: null, up: true };
    const cur = pick(latest);
    const prev = pick(weekAgo);
    return { delta: pctDelta(cur, prev), up: cur >= prev };
  };

  const spendK = kpi((r) => num(r.meta_spend_7d));
  const subsK = kpi((r) => num(r.net_new_subs_7d));
  const mrrK = kpi((r) => num(r.mrr_growth_7d));

  return (
    <>
      <PageHeader
        eyebrow="Admin / Marketing"
        title="Marketing Efficiency"
        subtitle="Blended Meta spend vs RevenueCat revenue & subscribers, on a 7-day rolling basis. The truth layer SKAN can't give at this volume — track MER and net-new growth against spend."
        actions={
          <Button variant="secondary" icon={<Icons.Refresh />} onClick={refresh}>
            Refresh
          </Button>
        }
      />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {latest && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
            marginBottom: 8,
          }}
        >
          <HeroCard
            label="MER · 7d"
            value={`${num(latest.mer_7d).toFixed(2)}×`}
            delta={
              merDelta == null
                ? undefined
                : `${merDelta >= 0 ? "↑" : "↓"} ${Math.abs(merDelta).toFixed(2)}×`
            }
            deltaUp={merDelta != null && merDelta >= 0}
            spark={sparkOf((r) => num(r.mer_7d))}
            note="RC revenue ÷ Meta spend · vs prior 7d"
          />
          <KpiCard
            label="Meta spend · 7d"
            value={fmtUSD(num(latest.meta_spend_7d))}
            delta={spendK.delta ?? undefined}
            deltaFamily="neutral"
            spark={sparkOf((r) => num(r.meta_spend_7d))}
            sparkFamily={null}
            note="vs prior 7d"
          />
          <KpiCard
            label="Net-new subs · 7d"
            value={String(num(latest.net_new_subs_7d))}
            delta={subsK.delta ?? undefined}
            deltaFamily={subsK.up ? "success" : "danger"}
            spark={sparkOf((r) => num(r.net_new_subs_7d))}
            sparkFamily={subsK.up ? "success" : "danger"}
            note="RevenueCat truth layer"
          />
          <KpiCard
            label="MRR growth · 7d"
            value={fmtUSD(num(latest.mrr_growth_7d))}
            delta={mrrK.delta ?? undefined}
            deltaFamily={mrrK.up ? "success" : "danger"}
            spark={sparkOf((r) => num(r.mrr_growth_7d))}
            sparkFamily={mrrK.up ? "success" : "danger"}
            note="net of churn & refunds"
          />
        </div>
      )}

      <MarketingAlerts />

      <ActiveExperiments />

      <PricingExperiments />

      <InfoWell style={{ margin: "26px 0 0" }}>
        <strong style={{ color: "var(--ink-2)", fontWeight: 650 }}>
          Read this as directional, not per-ad CAC.
        </strong>{" "}
        Revenue/subscribers are account-wide (paid + organic, and organic
        dominates), so MER credits ads with conversions they didn&rsquo;t all
        drive. The signal that matters is the <em>trend</em>: when spend rises
        but MER and MRR-growth don&rsquo;t, the marginal spend isn&rsquo;t
        pulling its weight. Confirm causally with a spend-pulldown / holdout
        test.
      </InfoWell>

      <SectionHeader
        family="accent"
        icon="Trend"
        title="Weekly trend"
        meta="7-day rolling"
      />
      <Card pad={0} style={{ overflowX: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}
        >
          <thead>
            <tr>
              {[
                "Week ending",
                "Spend",
                "Revenue",
                "MER",
                "Net-new subs",
                "MRR growth",
              ].map((h, i) => (
                <th key={h} style={thStyle(i === 0 ? "left" : "right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekly.map((r) => {
              const mer = num(r.mer_7d);
              return (
                <HoverRow key={r.date}>
                  <Td align="left" bold>
                    {fmtDate(r.date)}
                  </Td>
                  <Td>{fmtUSD(num(r.meta_spend_7d))}</Td>
                  <Td>{fmtUSD(num(r.revenue_7d))}</Td>
                  <Td>
                    <span
                      style={{
                        fontWeight: 650,
                        color:
                          mer >= 3
                            ? "var(--success-text)"
                            : mer < 2
                              ? "var(--danger-text)"
                              : "var(--ink)",
                      }}
                    >
                      {mer.toFixed(2)}×
                    </span>
                  </Td>
                  <Td>{num(r.net_new_subs_7d)}</Td>
                  <Td>{fmtUSD(num(r.mrr_growth_7d))}</Td>
                </HoverRow>
              );
            })}
          </tbody>
        </table>
      </Card>

      <CrossNetworkCost />

      <LtvCohorts />

      <PayerRetentionCohorts />

      <SkanAttribution />
    </>
  );
}

// ---------------------------------------------------------------------------
// Module 2 — LTV / retention cohorts by acquisition source. Ranks campaigns by
// predicted LTV per trial (trial->paid rate x LTV per payer), spend-driven and
// auto-enriching as per-ad RC attribution / SKAN postbacks arrive. The `source`
// badge shows the signal quality behind each row.
// ---------------------------------------------------------------------------
const LTV_SOURCE_LABEL: Record<
  CampaignLtvCohortRow["source"],
  { label: string; soft: string; text: string }
> = {
  rc_actual: {
    label: "RC actual",
    soft: "var(--success-soft)",
    text: "var(--success-text)",
  },
  skan_proxy: {
    label: "SKAN proxy",
    soft: "var(--info-soft)",
    text: "var(--info-text)",
  },
  account_blended: {
    label: "Acct blended",
    soft: "var(--neutral-soft)",
    text: "var(--neutral-text)",
  },
};

function LtvCohorts() {
  const [rows, setRows] = React.useState<CampaignLtvCohortRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await API.fetchCampaignLtvCohorts();
        if (alive) setRows(r);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <SectionHeader
        family="info"
        icon="Layers"
        title="LTV cohorts by acquisition source"
        meta="predicted LTV · 35d"
      />

      <InfoWell style={{ marginBottom: 14 }}>
        <strong style={{ color: "var(--ink-2)", fontWeight: 650 }}>
          Rank campaigns by predicted LTV/trial = trial→paid rate × LTV/payer.
        </strong>{" "}
        The trial→paid rate ladders by signal quality: <em>RC actual</em>{" "}
        (per-ad conversions) → <em>SKAN proxy</em> (day-7 conversion) →{" "}
        <em>Acct blended</em> (account-level rate, used today until
        per-campaign conversion signal matures — so most rows share the same
        rate for now). Per-campaign trial counts are an attributed subset; for
        absolute cost use the blended CAC above.
      </InfoWell>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading ? (
        <div
          style={{ padding: 24, color: "var(--ink-3)", fontSize: 13 }}
        >
          Loading LTV cohorts…
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 20, color: "var(--ink-3)", fontSize: 13 }}>
          No campaign spend in the last 35 days.
        </div>
      ) : (
        <Card pad={0} style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13.5,
            }}
          >
            <thead>
              <tr>
                {[
                  "Campaign",
                  "Spend",
                  "Trials",
                  "Trial→paid",
                  "LTV / payer",
                  "Pred. LTV / trial",
                  "Source",
                ].map((h, i) => (
                  <th
                    key={h}
                    style={thStyle(i === 0 ? "left" : i === 6 ? "center" : "right")}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t2p = r.trial_to_paid == null ? null : num(r.trial_to_paid);
                const predLtv =
                  r.predicted_ltv_per_trial == null
                    ? null
                    : num(r.predicted_ltv_per_trial);
                const badge =
                  LTV_SOURCE_LABEL[r.source] ?? LTV_SOURCE_LABEL.account_blended;
                return (
                  <HoverRow key={r.campaign_id ?? r.campaign_name ?? Math.random()}>
                    <Td align="left" bold>
                      {r.campaign_name ?? r.campaign_id ?? "—"}
                    </Td>
                    <Td>{r.spend == null ? "—" : fmtUSD(num(r.spend))}</Td>
                    <Td>
                      <span style={{ color: "var(--success-text)", fontWeight: 650 }}>
                        {num(r.trials)}
                      </span>
                    </Td>
                    <Td>{t2p == null ? "—" : `${(t2p * 100).toFixed(1)}%`}</Td>
                    <Td>
                      {r.ltv_per_payer == null ? "—" : fmtUSD(num(r.ltv_per_payer))}
                    </Td>
                    <Td>
                      {predLtv == null ? (
                        <span style={{ color: "var(--ink-4)" }}>—</span>
                      ) : (
                        <span style={{ fontWeight: 650, color: "var(--ink)" }}>
                          {fmtUSD(predLtv)}
                        </span>
                      )}
                    </Td>
                    <Td align="left">
                      <span
                        style={{
                          display: "inline-block",
                          font: "700 10px var(--font-ui)",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          padding: "3px 8px",
                          borderRadius: 7,
                          color: badge.text,
                          background: badge.soft,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {badge.label}
                      </span>
                    </Td>
                  </HoverRow>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Module 1 — Cross-Network Cost + Blended CAC. Unifies Meta + TikTok + manual
// channels into one per-campaign cost/CAC/ROAS surface (35d), with a blended
// row that uses RevenueCat as the truth denominator. Per-campaign counts are
// network-reported and unreliable on iOS — for relative ranking only.
// ---------------------------------------------------------------------------
function CrossNetworkCost() {
  const [rows, setRows] = React.useState<CrossNetworkCampaignRow[]>([]);
  const [blended, setBlended] = React.useState<CrossNetworkBlendedRow | null>(null);
  const [payback, setPayback] = React.useState<PaybackSummaryRow | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r, b, p] = await Promise.all([
          API.fetchCrossNetworkCampaigns(),
          API.fetchCrossNetworkBlended(),
          API.fetchPaybackSummary().catch(() => null),
        ]);
        if (!alive) return;
        setRows(r);
        setBlended(b);
        setPayback(p);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const cacTrial =
    blended?.blended_cac_per_trial_35d != null
      ? num(blended.blended_cac_per_trial_35d)
      : null;
  const cacSub =
    blended?.blended_cac_per_sub_35d != null
      ? num(blended.blended_cac_per_sub_35d)
      : null;
  const roas = blended?.blended_roas_35d != null ? num(blended.blended_roas_35d) : null;
  const coverage =
    blended?.network_trial_coverage != null
      ? num(blended.network_trial_coverage)
      : null;
  const ltvCac = payback?.ltv30_to_cac != null ? num(payback.ltv30_to_cac) : null;
  const channels = Array.from(new Set(rows.map((r) => r.channel)));

  return (
    <div>
      <SectionHeader
        family="success"
        icon="Dollar"
        title="Cross-network cost"
        meta="blended CAC · 35d"
      />

      <StatStrip
        stats={[
          {
            label: "Blended CAC / trial",
            value: cacTrial != null ? fmtUSD(cacTrial) : "—",
            note: "spend ÷ RC trials",
          },
          {
            label: "Blended CAC / sub",
            value: cacSub != null ? fmtUSD(cacSub) : "—",
          },
          {
            label: "LTV : CAC · 30d",
            value: ltvCac != null ? `${ltvCac.toFixed(2)}×` : "—",
            delta: ltvCac == null ? undefined : ltvCac >= 1 ? "≥ 1×" : "< 1×",
            deltaFamily: ltvCac == null ? undefined : ltvCac >= 1 ? "success" : "danger",
          },
          {
            label: "Payback",
            value: payback?.payback_verdict ?? "—",
          },
          {
            label: "Cross-network spend",
            value:
              blended?.total_spend_35d != null
                ? fmtUSD(num(blended.total_spend_35d))
                : "—",
          },
          {
            label: "Blended ROAS",
            value: roas != null ? `${roas.toFixed(2)}×` : "—",
          },
          {
            label: "Trial coverage",
            value: coverage != null ? `${(coverage * 100).toFixed(0)}%` : "—",
            note: "network ÷ RC",
          },
        ]}
      />

      <InfoWell style={{ margin: "14px 0" }}>
        <strong style={{ color: "var(--ink-2)", fontWeight: 650 }}>
          Blended CAC (spend ÷ RevenueCat trials) is the truth.
        </strong>{" "}
        Per-campaign trial / purchase / ROAS below are <em>network-reported</em>{" "}
        and unreliable on iOS — the networks see only a fraction of real trials
        (coverage above is network ÷ RC). Use the per-campaign rows to{" "}
        <em>rank</em> campaigns, not for absolute CAC.{" "}
        {channels.length > 0 && <>Channels in view: {channels.join(", ")}. </>}
        Hand-enter Apple Search Ads / influencer spend into{" "}
        <code className="mono" style={{ fontSize: 11.5 }}>
          manual_channel_spend
        </code>{" "}
        to fold it in.
      </InfoWell>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading ? (
        <div style={{ padding: 24, color: "var(--ink-3)", fontSize: 13 }}>
          Loading cross-network cost…
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 20, color: "var(--ink-3)", fontSize: 13 }}>
          No campaign spend in the last 35 days.
        </div>
      ) : (
        <Card pad={0} style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}
          >
            <thead>
              <tr>
                {[
                  "Channel",
                  "Campaign",
                  "Spend",
                  "Net trials",
                  "Cost / trial",
                  "Purch.",
                  "ROAS",
                ].map((h, i) => (
                  <th key={h} style={thStyle(i <= 1 ? "left" : "right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cpt = r.cost_per_trial == null ? null : num(r.cost_per_trial);
                const roasR = r.roas == null ? null : num(r.roas);
                return (
                  <HoverRow key={`${r.channel}:${r.campaign_id}`}>
                    <Td align="left">
                      <span
                        style={{
                          font: "700 10px var(--font-ui)",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          color: "var(--ink-3)",
                          border: "1px solid var(--line-2)",
                          padding: "3px 8px",
                          borderRadius: 7,
                        }}
                      >
                        {r.channel}
                      </span>
                    </Td>
                    <Td align="left" bold>
                      {r.campaign_name ?? r.campaign_id}
                    </Td>
                    <Td>{r.spend == null ? "—" : fmtUSD(num(r.spend))}</Td>
                    <Td>
                      <span style={{ color: "var(--success-text)", fontWeight: 650 }}>
                        {num(r.network_trials)}
                      </span>
                    </Td>
                    <Td>
                      {cpt == null ? (
                        <span
                          style={{ color: "var(--ink-4)" }}
                          title="no network-reported trials"
                        >
                          —
                        </span>
                      ) : (
                        fmtUSD(cpt)
                      )}
                    </Td>
                    <Td>{num(r.network_purchases)}</Td>
                    <Td>
                      {roasR == null ? (
                        <span style={{ color: "var(--ink-4)" }}>—</span>
                      ) : (
                        <span style={{ fontWeight: 650 }}>{roasR.toFixed(2)}×</span>
                      )}
                    </Td>
                  </HoverRow>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// First-party SKAdNetwork / AdAttributionKit attribution ("DIY MMP").
// Per-campaign trial/subscribe + cost-per, decoded from signature-verified
// Apple postbacks our own endpoint receives. RevenueCat remains the source of
// truth for absolute counts; this ranks campaigns SKAN can resolve.
// ---------------------------------------------------------------------------
function SkanAttribution() {
  const [rows, setRows] = React.useState<SkanCampaignEfficiencyRow[]>([]);
  const [recon, setRecon] = React.useState<SkanReconciliationRow | null>(null);
  const [health, setHealth] = React.useState<SkanHealthRow | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r, rc, h] = await Promise.all([
          API.fetchSkanCampaignEfficiency(),
          API.fetchSkanReconciliation(),
          API.fetchSkanHealth().catch(() => null),
        ]);
        if (!alive) return;
        setRows(r);
        setRecon(rc);
        setHealth(h);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const skanTrials = num(recon?.skan_trials);
  const rcTrials = num(recon?.rc_trials_35d);
  const blendedCac = recon?.blended_cac_35d != null ? num(recon.blended_cac_35d) : null;
  // What share of RevenueCat's trials SKAN managed to resolve to a campaign.
  const coverage = rcTrials > 0 ? skanTrials / rcTrials : null;

  return (
    <div>
      <SectionHeader
        family="neutral"
        icon="InfoCircle"
        title="First-party SKAN"
        meta="per-campaign attribution"
      />

      {/* Headline reconciliation + blended CAC — these work today from
          RevenueCat + Meta spend, even before any postbacks decode. */}
      <StatStrip
        stats={[
          {
            label: "Blended CAC · 35d",
            value: blendedCac != null ? fmtUSD(blendedCac) : "—",
          },
          {
            label: "RC trials · 35d",
            value: recon?.rc_trials_35d != null ? String(rcTrials) : "—",
          },
          { label: "SKAN trials decoded", value: String(skanTrials) },
          {
            label: "SKAN coverage",
            value: coverage != null ? `${(coverage * 100).toFixed(0)}%` : "—",
          },
        ]}
      />

      {/* Protect360-lite — postback integrity at a glance. Only meaningful once
          postbacks land; until then everything reads 0. */}
      {health != null && health.postbacks_total > 0 && (
        <InfoWell
          style={{
            margin: "14px 0 0",
            color: "var(--ink-2)",
            display: "flex",
            flexWrap: "wrap",
            gap: "6px 18px",
          }}
        >
          <span>
            <strong style={{ fontWeight: 650 }}>Postback health:</strong>{" "}
            {health.postbacks_total} received
          </span>
          <span>
            {health.sig_valid} valid sig
            {health.sig_invalid_or_unverified > 0 && (
              <strong style={{ color: "var(--danger-text)", fontWeight: 650 }}>
                {" "}
                · {health.sig_invalid_or_unverified} invalid/unverified
              </strong>
            )}
          </span>
          <span>
            redownloads {health.redownloads}
            {health.redownload_rate != null &&
              ` (${(num(health.redownload_rate) * 100).toFixed(0)}%)`}
          </span>
          <span>
            {health.click_through} click / {health.view_through} view
          </span>
        </InfoWell>
      )}

      {/* Limitations disclosure — required: never over-promise SKAN. */}
      <InfoWell style={{ margin: "14px 0" }}>
        <strong style={{ color: "var(--ink-2)", fontWeight: 650 }}>
          Blended CAC (Meta spend ÷ RevenueCat trials) is the number to trust.
        </strong>{" "}
        Per-campaign SKAN data below is aggregated by Apple, delayed 24–72h,
        and subject to privacy thresholds: low-volume campaigns come back with{" "}
        <em>no</em> campaign id and are grouped as <em>Unattributed</em> —{" "}
        <span style={{ color: "var(--ink-2)" }}>
          shown as &ldquo;—&rdquo;, which is not zero
        </span>
        . We can&rsquo;t beat that nulling (a paid MMP gets the same).
        RevenueCat is the source of truth for absolute counts; SKAN only ranks
        the campaigns it can resolve. Windows: <strong>P1</strong> 0–2d ·{" "}
        <strong>P2</strong> 3–7d · <strong>P3</strong> 8–35d.
      </InfoWell>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading ? (
        <div style={{ padding: 24, color: "var(--ink-3)", fontSize: 13 }}>
          Loading SKAN attribution…
        </div>
      ) : rows.length === 0 ? (
        <SkanEmptyState />
      ) : (
        <SkanCampaignTable rows={rows} />
      )}
    </div>
  );
}

// Honest empty state: the pipeline is live + verifying, but postbacks only
// begin after the iOS endpoint ships and Apple's 24–72h delay elapses.
function SkanEmptyState() {
  return (
    <div
      style={{
        padding: "20px 22px",
        borderRadius: 16,
        background: "var(--surface)",
        border: "1px dashed var(--line-2)",
        color: "var(--ink-2)",
        fontSize: 13.5,
        lineHeight: 1.6,
      }}
    >
      <div style={{ font: "650 15px var(--font-ui)", marginBottom: 6 }}>
        Collector live · awaiting first postbacks
      </div>
      The endpoint is deployed and signature-verifying. Per-campaign rows light
      up 24–72h after the iOS build that declares our attribution endpoint
      ships (see{" "}
      <code className="mono" style={{ fontSize: 11.5 }}>
        docs/skan-diy-attribution.md
      </code>
      ). Until then, the blended CAC and RevenueCat totals above are the live
      truth layer.
    </div>
  );
}

function SkanCampaignTable({ rows }: { rows: SkanCampaignEfficiencyRow[] }) {
  // Distinguish a real 0 from a privacy-nulled value: null -> muted "—".
  const cell = (v: number | null | undefined, render: (n: number) => string) =>
    v == null ? (
      <span
        style={{ color: "var(--ink-4)" }}
        title="below Apple's privacy threshold — not zero"
      >
        —
      </span>
    ) : (
      render(v)
    );
  const spendOf = (r: SkanCampaignEfficiencyRow) =>
    r.spend == null ? null : num(r.spend);
  const cptOf = (r: SkanCampaignEfficiencyRow) =>
    r.cost_per_skan_trial == null ? null : num(r.cost_per_skan_trial);
  const cpsOf = (r: SkanCampaignEfficiencyRow) =>
    r.cost_per_skan_subscribe == null ? null : num(r.cost_per_skan_subscribe);

  return (
    <Card pad={0} style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
        <thead>
          <tr>
            {[
              "Campaign",
              "Spend",
              "SKAN trials",
              "Cost / trial",
              "SKAN subs",
              "Cost / sub",
              "Trials P1·P2·P3",
            ].map((h, i) => (
              <th key={h} style={thStyle(i === 0 ? "left" : "right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const unattributed = r.campaign_id == null;
            const label =
              r.campaign_name ??
              (r.source_identifier
                ? `Unattributed · src ${r.source_identifier}`
                : "Unattributed");
            return (
              <HoverRow key={r.campaign_key}>
                <Td align="left" bold={!unattributed}>
                  <span
                    style={{
                      color: unattributed ? "var(--ink-3)" : "var(--ink)",
                    }}
                  >
                    {label}
                  </span>
                </Td>
                <Td>{cell(spendOf(r), fmtUSD)}</Td>
                <Td>
                  <span style={{ color: "var(--success-text)", fontWeight: 650 }}>
                    {num(r.skan_trials)}
                  </span>
                </Td>
                <Td>{cell(cptOf(r), fmtUSD)}</Td>
                <Td>{num(r.skan_subscribes)}</Td>
                <Td>{cell(cpsOf(r), fmtUSD)}</Td>
                <Td>
                  <span style={{ color: "var(--ink-2)", fontSize: 12.5 }}>
                    {num(r.trials_p1)}·{num(r.trials_p2)}·{num(r.trials_p3)}
                  </span>
                </Td>
              </HoverRow>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function ActiveExperiments() {
  if (EXPERIMENTS.length === 0) return null;
  return (
    <div>
      <SectionHeader family="accent" icon="Flask" title="Active experiments" />
      <div style={{ display: "grid", gap: 14 }}>
        {EXPERIMENTS.map((x) => {
          const left = daysUntil(x.readISO);
          const ready = left <= 0;
          return (
            <Card key={x.id}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ font: "650 15px var(--font-ui)", color: "var(--ink)" }}>
                  {x.title}
                </span>
                <span
                  style={{
                    font: "400 14px var(--font-ui)",
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--ink-2)",
                  }}
                >
                  {x.change}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <StatusPill kind={ready ? "attention" : "running"}>
                    {ready ? "READY TO READ" : "RUNNING"}
                  </StatusPill>
                  <span
                    style={{
                      font: "500 12.5px var(--font-ui)",
                      color: "var(--ink-3)",
                      flex: "none",
                    }}
                  >
                    {ready
                      ? `read due ${fmtDate(x.readISO)}`
                      : `reads ${fmtDate(x.readISO)} · ${left}d`}
                  </span>
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: "12px 20px",
                  background: "var(--surface-2)",
                  borderRadius: 12,
                  padding: "14px 16px",
                  marginTop: 12,
                }}
              >
                {x.stats.map((s) => (
                  <div key={s.label}>
                    <div
                      style={{
                        font: "500 12px var(--font-ui)",
                        color: "var(--ink-3)",
                      }}
                    >
                      {s.label}
                    </div>
                    <div
                      style={{
                        font: "650 15px var(--font-ui)",
                        fontVariantNumeric: "tabular-nums",
                        marginTop: 3,
                        color: s.tone
                          ? `var(--${s.tone}-text)`
                          : "var(--ink)",
                      }}
                    >
                      {s.value}{" "}
                      {s.sub && (
                        <span
                          style={{
                            font: "400 12px var(--font-ui)",
                            color: "var(--ink-4)",
                          }}
                        >
                          {s.sub}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 11.5,
                  color: "var(--ink-3)",
                  marginTop: 10,
                }}
              >
                {x.file}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anomaly alerts (Singular-style). Unresolved spend/CPI/CTR/CPM anomalies from
// the last 3 days, written daily by /api/cron/marketing-alerts. Renders nothing
// when all-clear so the page stays quiet by default. Porcelain: only
// critical/notable rows show; informational alerts collapse into a gray
// footer row with a Show toggle — severity carried by the icon tile.
// ---------------------------------------------------------------------------
const ALERT_SEVERITY: Record<MarketingAlertRow["severity"], Severity> = {
  critical: "critical",
  warn: "notable",
  info: "info",
};

function alertKind(a: MarketingAlertRow): string {
  const metric = a.metric.toLowerCase();
  const label = ["ctr", "cpm", "cpi", "mer"].includes(metric)
    ? metric.toUpperCase()
    : a.metric.charAt(0).toUpperCase() + a.metric.slice(1).toLowerCase();
  return a.direction ? `${label} ${a.direction}` : label;
}

// "Account: Spend drop — $284.97 vs $398.13 14d avg (z=-2.5)" → the value pair.
function alertValues(a: MarketingAlertRow): { v1: string; v2: string } | null {
  const m = a.message.match(/[—-]\s*(.+?)\s+vs\s+(.+?)\s*\(z/);
  if (m) return { v1: m[1], v2: m[2] };
  if (a.value != null && a.baseline != null)
    return { v1: String(a.value), v2: `${a.baseline} 14d avg` };
  return null;
}

function alertSource(a: MarketingAlertRow): string {
  return a.scope === "account" ? "Account" : (a.campaign_name ?? a.campaign_id ?? "Campaign");
}

function fmtZ(z: MarketingAlertRow["z"]): string {
  const n = num(z);
  return n < 0 ? `−${Math.abs(n)}` : String(n);
}

function MarketingAlerts() {
  const [alerts, setAlerts] = React.useState<MarketingAlertRow[]>([]);
  const [showInfo, setShowInfo] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    API.fetchMarketingAlerts(3)
      .then((a) => {
        if (alive) setAlerts(a);
      })
      .catch(() => {
        /* table may not exist yet on older deploys — stay quiet */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!alerts.length) return null;

  const actionable = alerts.filter((a) => a.severity !== "info");
  const informational = alerts.filter((a) => a.severity === "info");
  const visible = showInfo ? [...actionable, ...informational] : actionable;

  const row = (a: MarketingAlertRow, i: number) => {
    const sev = ALERT_SEVERITY[a.severity];
    const vals = alertValues(a);
    return (
      <div
        key={a.id}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          borderTop: i ? "1px solid var(--line)" : "none",
        }}
      >
        <SeverityTile severity={sev} />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13.5,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <span style={{ fontWeight: 650, color: severityTextColor(sev) }}>
            {alertKind(a)}
          </span>
          <span style={{ color: "var(--ink-3)" }}> · {alertSource(a)}</span>
        </div>
        {vals ? (
          <span
            style={{
              fontSize: 13.5,
              fontVariantNumeric: "tabular-nums",
              flex: "none",
              textAlign: "right",
            }}
          >
            <b style={{ fontWeight: 650, color: "var(--ink)" }}>{vals.v1}</b>
            <span style={{ color: "var(--ink-4)" }}> vs {vals.v2}</span>
          </span>
        ) : (
          <span
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              flex: "none",
              maxWidth: 380,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {a.message}
          </span>
        )}
        <span
          style={{
            font: "400 12.5px var(--font-ui)",
            fontVariantNumeric: "tabular-nums",
            color: "var(--ink-4)",
            width: 104,
            textAlign: "right",
            flex: "none",
          }}
        >
          z {fmtZ(a.z)} · {fmtDate(a.alert_date)}
        </span>
      </div>
    );
  };

  return (
    <div>
      <SectionHeader
        family="danger"
        icon="Octagon"
        title="Anomaly alerts"
        meta={`${actionable.length} need a look · last 3 days`}
      />
      <Card pad={0} style={{ overflow: "hidden" }}>
        {visible.map(row)}
        {informational.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "11px 16px",
              borderTop: visible.length ? "1px solid var(--line)" : "none",
              background: "var(--surface-2)",
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                color: "var(--ink-3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
              }}
            >
              <Icons.InfoCircle size={16} strokeWidth={1.8} />
            </span>
            <span
              style={{
                flex: 1,
                font: "400 13px var(--font-ui)",
                color: "var(--ink-3)",
              }}
            >
              {informational.length} informational — spikes above baseline,
              likely good
            </span>
            <button
              onClick={() => setShowInfo((s) => !s)}
              style={{
                font: "600 12.5px var(--font-ui)",
                color: "var(--link)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {showInfo ? "Hide" : "Show"}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payer retention cohorts (AppsFlyer-style cohort report). Weekly cohorts by
// first_active_at from rc_customer_snapshot — fills after the first
// audience-sync run populates the snapshot; silent until then.
// ---------------------------------------------------------------------------
function PayerRetentionCohorts() {
  const [rows, setRows] = React.useState<PayerRetentionCohortRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    API.fetchPayerRetentionCohorts()
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <SectionHeader
        family="info"
        icon="Grid"
        title="Payer retention cohorts"
        meta="weekly"
      />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {rows.length === 0 ? (
        <InfoWell>
          No cohort data yet — fills automatically after the weekly
          audience-sync cron snapshots RevenueCat payers (Mondays 08:00 UTC, or
          trigger{" "}
          <code className="mono" style={{ fontSize: 11.5 }}>
            /api/cron/refresh-audiences
          </code>{" "}
          manually).
        </InfoWell>
      ) : (
        <Card pad={0} style={{ overflow: "hidden" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}
          >
            <thead>
              <tr>
                {[
                  "Cohort week",
                  "Payers",
                  "Active now",
                  "Lapsed",
                  "Retention",
                  "Avg tenure",
                ].map((h, i) => (
                  <th key={h} style={thStyle(i === 0 ? "left" : "right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ret = r.retention_rate != null ? num(r.retention_rate) : null;
                return (
                  <HoverRow key={r.cohort_week}>
                    <Td align="left" bold>
                      {fmtDate(r.cohort_week)}
                    </Td>
                    <Td>{r.payers}</Td>
                    <Td>{r.active_now}</Td>
                    <Td>{r.lapsed}</Td>
                    <Td>
                      <span
                        style={{
                          fontWeight: 650,
                          color:
                            ret == null
                              ? "var(--ink-4)"
                              : ret >= 0.8
                                ? "var(--success-text)"
                                : ret < 0.5
                                  ? "var(--danger-text)"
                                  : "var(--ink)",
                        }}
                      >
                        {ret != null ? `${(ret * 100).toFixed(0)}%` : "—"}
                      </span>
                    </Td>
                    <Td>
                      {r.avg_tenure_days != null
                        ? `${num(r.avg_tenure_days).toFixed(0)}d`
                        : "—"}
                    </Td>
                  </HoverRow>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function HoverRow({ children }: { children: React.ReactNode }) {
  return (
    <tr
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "var(--surface-2)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      style={{ transition: "background 120ms ease" }}
    >
      {children}
    </tr>
  );
}

function Td({
  children,
  align = "right",
  bold,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  bold?: boolean;
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: "11px 16px",
        borderTop: "1px solid var(--line)",
        color: "var(--ink)",
        fontWeight: bold ? 650 : 400,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </td>
  );
}
