"use client";

import * as React from "react";
import { PageHeader } from "./Shell";
import { API } from "@/lib/supabase";
import type { BlendedEfficiencyRow } from "@/lib/types";

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
    </>
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
