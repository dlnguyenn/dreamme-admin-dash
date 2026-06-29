"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { API } from "@/lib/supabase";
import type {
  BlendedEfficiencyRow,
  SkanCampaignEfficiencyRow,
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

interface DashExperiment {
  id: string;
  title: string;
  change: string;
  startedISO: string;
  readISO: string;
  baseline: string;
  rule: string;
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
    baseline: "Baseline: $2.65 CPI · 1.35 freq · 400 installs/wk",
    rule: "Win if CPI holds ≤ $3.20 · Fail if CPI > $3.45 → revert to $150",
    file: "experiments/2026-06-11-comic-sans-budget-scale.md",
  },
];

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
      <div style={{ padding: 80, textAlign: "center", color: "var(--ink-3)" }}>
        <div className="serif" style={{ fontSize: 24, fontStyle: "italic" }}>
          Loading efficiency…
        </div>
      </div>
    );
  }

  const latest = rows[0];
  // Rows arrive newest-first; sampling every 7th gives a clean ~weekly trend.
  const weekly = rows.filter((_, i) => i % 7 === 0).slice(0, 10);

  return (
    <>
      <PageHeader
        eyebrow="Admin · Marketing"
        title={<em>Marketing Efficiency</em>}
        subtitle="Blended Meta spend vs RevenueCat revenue & subscribers, on a 7-day rolling basis. The truth layer SKAN can't give at this volume — track MER and net-new growth against spend."
        tint="color-mix(in oklab, var(--p-emma) 45%, transparent)"
        actions={
          <button
            onClick={refresh}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              color: "var(--ink-2)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
        }
      />

      {error && (
        <div
          style={{
            marginBottom: 20,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--accent)",
            background: "color-mix(in oklab, var(--accent) 10%, var(--surface))",
            border: "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
            borderRadius: 10,
          }}
        >
          {error}
        </div>
      )}

      {latest && (
        <div
          style={{
            display: "grid",
            // auto-fit so cards wrap (4-across on desktop, 2-up on mobile)
            // instead of overflowing — `1fr` tracks can't shrink below the
            // large serif numbers, so a fixed 4-col grid spills off-screen.
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 14,
            marginBottom: 24,
          }}
        >
          <HeadlineCard
            label="MER · 7d"
            value={`${num(latest.mer_7d).toFixed(2)}×`}
            tone="ink"
          />
          <HeadlineCard
            label="Meta spend · 7d"
            value={fmtUSD(num(latest.meta_spend_7d))}
            tone="neutral"
          />
          <HeadlineCard
            label="Net-new subs · 7d"
            value={String(num(latest.net_new_subs_7d))}
            tone="neutral"
          />
          <HeadlineCard
            label="MRR growth · 7d"
            value={fmtUSD(num(latest.mrr_growth_7d))}
            tone="neutral"
          />
        </div>
      )}

      <ActiveExperiments />

      <div
        style={{
          marginBottom: 24,
          padding: "12px 16px",
          fontSize: 12.5,
          lineHeight: 1.5,
          color: "var(--ink-3)",
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          borderRadius: 12,
        }}
      >
        <strong style={{ color: "var(--ink-2)" }}>Read this as directional, not per-ad CAC.</strong>{" "}
        Revenue/subscribers are account-wide (paid + organic, and organic dominates),
        so MER credits ads with conversions they didn&rsquo;t all drive. The signal that
        matters is the <em>trend</em>: when spend rises but MER and MRR-growth don&rsquo;t,
        the marginal spend isn&rsquo;t pulling its weight. Confirm causally with a
        spend-pulldown / holdout test.
      </div>

      <SectionLabel>Weekly trend (7-day rolling)</SectionLabel>
      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 14,
          // scroll horizontally on narrow screens rather than clipping columns
          overflowX: "auto",
          background: "var(--surface)",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Week ending", "Spend", "Revenue", "MER", "Net-new subs", "MRR growth"].map(
                (h, i) => (
                  <th
                    key={h}
                    style={{
                      textAlign: i === 0 ? "left" : "right",
                      padding: "11px 16px",
                      fontSize: 10,
                      fontFamily: "var(--font-geist-mono), monospace",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      color: "var(--ink-3)",
                      borderBottom: "1px solid var(--line)",
                      background: "var(--surface-2)",
                    }}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {weekly.map((r) => {
              const mer = num(r.mer_7d);
              return (
                <tr key={r.date}>
                  <Td align="left">{fmtDate(r.date)}</Td>
                  <Td>{fmtUSD(num(r.meta_spend_7d))}</Td>
                  <Td>{fmtUSD(num(r.revenue_7d))}</Td>
                  <Td>
                    <span
                      style={{
                        fontFamily: "var(--font-geist-mono), monospace",
                        color:
                          mer >= 3
                            ? "color-mix(in oklab, var(--p-olivia) 70%, var(--ink))"
                            : mer < 2
                              ? "var(--accent)"
                              : "var(--ink-2)",
                      }}
                    >
                      {mer.toFixed(2)}×
                    </span>
                  </Td>
                  <Td>{num(r.net_new_subs_7d)}</Td>
                  <Td>{fmtUSD(num(r.mrr_growth_7d))}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ height: 36 }} />
      <SkanAttribution />
    </>
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
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r, rc] = await Promise.all([
          API.fetchSkanCampaignEfficiency(),
          API.fetchSkanReconciliation(),
        ]);
        if (!alive) return;
        setRows(r);
        setRecon(rc);
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
      <SectionLabel>First-party SKAN · per-campaign attribution</SectionLabel>

      {/* Headline reconciliation + blended CAC — these work today from
          RevenueCat + Meta spend, even before any postbacks decode. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 14,
          marginBottom: 16,
        }}
      >
        <HeadlineCard
          label="Blended CAC · 35d"
          value={blendedCac != null ? fmtUSD(blendedCac) : "—"}
          tone="ink"
        />
        <HeadlineCard
          label="RC trials · 35d"
          value={recon?.rc_trials_35d != null ? String(rcTrials) : "—"}
          tone="neutral"
        />
        <HeadlineCard
          label="SKAN trials decoded"
          value={String(skanTrials)}
          tone="neutral"
        />
        <HeadlineCard
          label="SKAN coverage"
          value={coverage != null ? `${(coverage * 100).toFixed(0)}%` : "—"}
          tone="neutral"
        />
      </div>

      {/* Limitations disclosure — required: never over-promise SKAN. */}
      <div
        style={{
          marginBottom: 16,
          padding: "12px 16px",
          fontSize: 12.5,
          lineHeight: 1.5,
          color: "var(--ink-3)",
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          borderRadius: 12,
        }}
      >
        <strong style={{ color: "var(--ink-2)" }}>
          Blended CAC (Meta spend ÷ RevenueCat trials) is the number to trust.
        </strong>{" "}
        Per-campaign SKAN data below is aggregated by Apple, delayed 24–72h, and
        subject to privacy thresholds: low-volume campaigns come back with{" "}
        <em>no</em> campaign id and are grouped as <em>Unattributed</em> —{" "}
        <span style={{ color: "var(--ink-2)" }}>shown as “—”, which is not zero</span>.
        We can&rsquo;t beat that nulling (a paid MMP gets the same). RevenueCat is
        the source of truth for absolute counts; SKAN only ranks the campaigns it
        can resolve. Windows: <strong>P1</strong> 0–2d · <strong>P2</strong> 3–7d ·{" "}
        <strong>P3</strong> 8–35d.
      </div>

      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--accent)",
            background: "color-mix(in oklab, var(--accent) 10%, var(--surface))",
            border: "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
            borderRadius: 10,
          }}
        >
          {error}
        </div>
      )}

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
        borderRadius: 14,
        background: "var(--surface)",
        border: "1px dashed var(--line)",
        color: "var(--ink-2)",
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <div className="serif" style={{ fontSize: 18, marginBottom: 6 }}>
        Collector live · awaiting first postbacks
      </div>
      The endpoint is deployed and signature-verifying. Per-campaign rows light
      up 24–72h after the iOS build that declares our attribution endpoint ships
      (see <code>docs/skan-diy-attribution.md</code>). Until then, the blended
      CAC and RevenueCat totals above are the live truth layer.
    </div>
  );
}

function SkanCampaignTable({ rows }: { rows: SkanCampaignEfficiencyRow[] }) {
  // Distinguish a real 0 from a privacy-nulled value: null -> muted "—".
  const cell = (v: number | null | undefined, render: (n: number) => string) =>
    v == null ? (
      <span style={{ color: "var(--ink-3)" }} title="below Apple's privacy threshold — not zero">
        —
      </span>
    ) : (
      render(v)
    );
  const spendOf = (r: SkanCampaignEfficiencyRow) => (r.spend == null ? null : num(r.spend));
  const cptOf = (r: SkanCampaignEfficiencyRow) =>
    r.cost_per_skan_trial == null ? null : num(r.cost_per_skan_trial);
  const cpsOf = (r: SkanCampaignEfficiencyRow) =>
    r.cost_per_skan_subscribe == null ? null : num(r.cost_per_skan_subscribe);

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 14,
        overflowX: "auto",
        background: "var(--surface)",
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
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
              <th
                key={h}
                style={{
                  textAlign: i === 0 ? "left" : "right",
                  padding: "11px 16px",
                  fontSize: 10,
                  fontFamily: "var(--font-geist-mono), monospace",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: "var(--ink-3)",
                  borderBottom: "1px solid var(--line)",
                  background: "var(--surface-2)",
                  whiteSpace: "nowrap",
                }}
              >
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
              <tr key={r.campaign_key}>
                <Td align="left">
                  <span
                    style={{
                      color: unattributed ? "var(--ink-3)" : "var(--ink)",
                      fontStyle: unattributed ? "italic" : "normal",
                    }}
                  >
                    {label}
                  </span>
                </Td>
                <Td>{cell(spendOf(r), fmtUSD)}</Td>
                <Td>{num(r.skan_trials)}</Td>
                <Td>{cell(cptOf(r), fmtUSD)}</Td>
                <Td>{num(r.skan_subscribes)}</Td>
                <Td>{cell(cpsOf(r), fmtUSD)}</Td>
                <Td>
                  <span
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      color: "var(--ink-2)",
                      fontSize: 12,
                    }}
                  >
                    {num(r.trials_p1)}·{num(r.trials_p2)}·{num(r.trials_p3)}
                  </span>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ActiveExperiments() {
  if (EXPERIMENTS.length === 0) return null;
  return (
    <div style={{ marginBottom: 24 }}>
      <SectionLabel>Active experiments</SectionLabel>
      <div style={{ display: "grid", gap: 12 }}>
        {EXPERIMENTS.map((x) => {
          const left = daysUntil(x.readISO);
          const ready = left <= 0;
          return (
            <div
              key={x.id}
              style={{
                padding: "16px 18px",
                borderRadius: 14,
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderLeft: `3px solid ${
                  ready ? "var(--accent)" : "color-mix(in oklab, var(--p-emma) 65%, var(--ink))"
                }`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 8,
                }}
              >
                <div className="serif" style={{ fontSize: 19, letterSpacing: "-0.02em" }}>
                  {x.title}{" "}
                  <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>· {x.change}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--font-geist-mono), monospace",
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      padding: "3px 8px",
                      borderRadius: 999,
                      color: ready ? "var(--accent)" : "color-mix(in oklab, var(--p-olivia) 70%, var(--ink))",
                      background: ready
                        ? "color-mix(in oklab, var(--accent) 12%, var(--surface))"
                        : "color-mix(in oklab, var(--p-olivia) 14%, var(--surface))",
                      border: "1px solid var(--line)",
                    }}
                  >
                    {ready ? "Ready to read" : "Running"}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-geist-mono), monospace",
                      color: "var(--ink-3)",
                    }}
                  >
                    {ready
                      ? `read due ${fmtDate(x.readISO)}`
                      : `reads ${fmtDate(x.readISO)} · ${left}d`}
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginBottom: 4 }}>
                {x.baseline}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{x.rule}</div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  fontFamily: "var(--font-geist-mono), monospace",
                  color: "var(--ink-3)",
                }}
              >
                {x.file}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Td({
  children,
  align = "right",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: "11px 16px",
        borderBottom: "1px solid var(--line)",
        color: "var(--ink)",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </td>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontFamily: "var(--font-geist-mono), monospace",
        textTransform: "uppercase",
        letterSpacing: "0.14em",
        color: "var(--ink-3)",
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

function HeadlineCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ink" | "neutral";
}) {
  const isInk = tone === "ink";
  return (
    <div
      style={{
        padding: "18px 20px",
        borderRadius: 14,
        background: isInk ? "var(--ink)" : "var(--surface-2)",
        color: isInk ? "var(--surface)" : "var(--ink)",
        border: isInk ? "1px solid var(--ink)" : "1px solid var(--line)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          opacity: isInk ? 0.7 : 0.6,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        className="serif"
        style={{
          fontSize: 32,
          fontWeight: 400,
          letterSpacing: "-0.025em",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}
