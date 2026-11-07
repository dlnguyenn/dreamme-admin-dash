"use client";

/**
 * Paid: today so far, yesterday, the same day last week and the last 7
 * complete days in one table, then the same numbers per campaign.
 *
 * Trials lead with RevenueCat (every source, the real count) and show Meta's
 * own count under it. Meta claims view-through and organic trials, so its
 * count can be higher than the real total; neither is "paid trials".
 */

import * as React from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import type { PaidSection } from "@/lib/overview";
import type { PaidCounts, PaidDay } from "@/lib/overview-paid";
import { Card, SectionHeader, fam, thStyle } from "../porcelain";
import { EmptyState, GoToLink, fmtMoney, fmtNum } from "./shared";

type Fmt = (n: number | null | undefined) => string;
const money0: Fmt = (n) => fmtMoney(n, 0);
const money2: Fmt = (n) => fmtMoney(n, 2);
const times: Fmt = (n) => (n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(2)}x`);

/** "Fri, Oct 31" from an ISO day, read as a calendar date (no timezone shift). */
function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface MetricRow {
  label: string;
  hint?: string;
  get: (d: PaidDay) => number | null;
  fmt: Fmt;
  strong?: boolean;
  /** Which way is good, for the yesterday-vs-last-week chip. */
  better?: "up" | "down";
}

const ROWS: MetricRow[] = [
  { label: "Ad spend", hint: "Meta", get: (d) => d.spend, fmt: money0, strong: true },
  { label: "Trials", hint: "RevenueCat, all sources", get: (d) => d.trials, fmt: fmtNum, strong: true, better: "up" },
  { label: "Trials", hint: "Meta-reported", get: (d) => d.metaTrials, fmt: fmtNum, better: "up" },
  { label: "Cost per trial", hint: "spend ÷ all trials", get: (d) => d.costPerTrial, fmt: money2, strong: true, better: "down" },
  { label: "Cost per trial", hint: "Meta-reported", get: (d) => d.metaCostPerTrial, fmt: money2, better: "down" },
  { label: "Revenue", hint: "gross, before store fees", get: (d) => d.revenue, fmt: money0, strong: true, better: "up" },
  { label: "Revenue ÷ spend", get: (d) => (d.revenue != null && d.spend ? d.revenue / d.spend : null), fmt: times, better: "up" },
  { label: "Installs", hint: "Meta", get: (d) => d.installs, fmt: fmtNum },
  { label: "Cost per install", get: (d) => d.cpi, fmt: money2, better: "down" },
];

function Delta({ now, then, better }: { now: number | null; then: number | null; better?: "up" | "down" }) {
  if (!better || now == null || then == null || then === 0) return null;
  const pct = ((now - then) / Math.abs(then)) * 100;
  if (!Number.isFinite(pct) || Math.abs(pct) < 0.5) return null;
  const good = better === "up" ? pct > 0 : pct < 0;
  const f = fam(good ? "success" : "danger");
  return (
    <span
      title="Yesterday vs the same day last week"
      style={{
        marginLeft: 6,
        font: "650 10.5px var(--font-ui)",
        color: f.text,
        whiteSpace: "nowrap",
      }}
    >
      {pct > 0 ? "▲" : "▼"}
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

const td = (align: "left" | "right" = "right", compact = false): React.CSSProperties => ({
  textAlign: align,
  padding: compact ? "8px 8px" : "9px 14px",
  borderBottom: "1px solid var(--line)",
  // Longhands, not `font`: cells override fontWeight, and React warns when a
  // shorthand and its longhand change together on rerender.
  fontFamily: "var(--font-ui)",
  fontSize: compact ? 12.5 : 13,
  fontWeight: 400,
  fontVariantNumeric: "tabular-nums",
  color: "var(--ink-2)",
  whiteSpace: "nowrap",
});

/** Emphasis for the yesterday column: the last complete day is the one to act on. */
const YDAY_BG = "var(--surface-2)";

function SummaryTable({ paid, compact }: { paid: NonNullable<PaidSection["daily"]>; compact: boolean }) {
  const pad = compact ? "10px 8px" : "10px 14px";
  const cols: { key: string; title: string; sub: string; day: PaidDay; yday?: boolean }[] = [
    { key: "today", title: "Today", sub: "so far", day: paid.today },
    { key: "yday", title: "Yesterday", sub: dayLabel(paid.yesterday.date), day: paid.yesterday, yday: true },
    { key: "week", title: "7 days ago", sub: dayLabel(paid.weekAgo.date), day: paid.weekAgo },
    { key: "last7", title: "Last 7 days", sub: "complete days", day: paid.last7 },
  ];
  return (
    <div style={{ overflowX: "auto", contain: "inline-size" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: compact ? 0 : 560 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle("left"), padding: pad }} />
            {cols.map((c) => (
              <th
                key={c.key}
                style={{ ...thStyle("right"), padding: pad, background: c.yday ? YDAY_BG : undefined }}
              >
                <div style={{ color: c.yday ? "var(--ink)" : undefined }}>{c.title}</div>
                <div style={{ font: "400 11px var(--font-ui)", textTransform: "none", letterSpacing: 0, marginTop: 2 }}>
                  {c.sub}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={`${r.label}-${r.hint ?? ""}`}>
              <td style={{ ...td("left", compact), color: "var(--ink)", whiteSpace: compact ? "normal" : "nowrap" }}>
                <span style={{ fontWeight: r.strong ? 650 : 450 }}>{r.label}</span>
                {r.hint && (
                  <span
                    style={{
                      display: compact ? "block" : "inline",
                      marginLeft: compact ? 0 : 6,
                      font: `400 ${compact ? 10.5 : 11.5}px var(--font-ui)`,
                      color: "var(--ink-3)",
                    }}
                  >
                    {r.hint}
                  </span>
                )}
              </td>
              {cols.map((c) => (
                <td
                  key={c.key}
                  style={{
                    ...td("right", compact),
                    background: c.yday ? YDAY_BG : undefined,
                    color: r.strong ? "var(--ink)" : "var(--ink-2)",
                    fontWeight: r.strong ? 650 : 400,
                  }}
                >
                  {r.fmt(r.get(c.day))}
                  {c.yday && <Delta now={r.get(paid.yesterday)} then={r.get(paid.weekAgo)} better={r.better} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CampaignTable({ paid }: { paid: NonNullable<PaidSection["daily"]> }) {
  if (paid.campaigns.length === 0) return null;
  const cpt = (c: PaidCounts) => (c.spend != null && c.metaTrials ? c.spend / c.metaTrials : null);
  const cpi = (c: PaidCounts) => (c.spend != null && c.installs ? c.spend / c.installs : null);
  return (
    <div style={{ overflowX: "auto", contain: "inline-size", marginTop: 18 }}>
      <div
        style={{
          font: "650 10.5px var(--font-ui)",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--ink-3)",
          margin: "0 0 4px 14px",
        }}
      >
        By campaign · Meta-reported
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle("left"), padding: "10px 14px" }}>Campaign</th>
            <th style={{ ...thStyle(), padding: "10px 14px" }}>Spend today</th>
            <th style={{ ...thStyle(), padding: "10px 14px", background: YDAY_BG }}>Spend yday</th>
            <th style={{ ...thStyle(), padding: "10px 14px", background: YDAY_BG }}>Trials yday</th>
            <th style={{ ...thStyle(), padding: "10px 14px", background: YDAY_BG }}>CPT yday</th>
            <th style={{ ...thStyle(), padding: "10px 14px" }}>Spend 7d</th>
            <th style={{ ...thStyle(), padding: "10px 14px" }}>CPT 7d</th>
            <th style={{ ...thStyle(), padding: "10px 14px" }}>CPI 7d</th>
          </tr>
        </thead>
        <tbody>
          {paid.campaigns.map((c) => (
            <tr key={c.id}>
              <td
                style={{ ...td("left"), color: "var(--ink)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}
                title={c.name}
              >
                {c.name}
              </td>
              <td style={td()}>{money0(c.today.spend)}</td>
              <td style={{ ...td(), background: YDAY_BG }}>{money0(c.yesterday.spend)}</td>
              <td style={{ ...td(), background: YDAY_BG }}>{fmtNum(c.yesterday.metaTrials)}</td>
              <td style={{ ...td(), background: YDAY_BG, color: "var(--ink)", fontWeight: 650 }}>
                {money2(cpt(c.yesterday))}
              </td>
              <td style={td()}>{money0(c.last7.spend)}</td>
              <td style={{ ...td(), color: "var(--ink)", fontWeight: 650 }}>{money2(cpt(c.last7))}</td>
              <td style={td()}>{money2(cpi(c.last7))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PaidPanel({ paid, onOpen }: { paid: PaidSection | null; onOpen: () => void }) {
  const isMobile = useIsMobile();
  if (!paid) return null;
  const daily = paid.daily;

  const notes: string[] = [];
  if (daily?.metaSource === "synced") {
    notes.push(`Live Meta read failed (${daily.metaError ?? "unknown error"}), so past days are from the 3am sync and today is blank.`);
  } else if (daily && daily.metaSource == null) {
    notes.push(`Couldn't read Meta spend: ${daily.metaError ?? "unknown error"}.`);
  }
  if (daily?.revenueError) notes.push(`Revenue failed to load: ${daily.revenueError}.`);

  return (
    <>
      <SectionHeader
        family="warning"
        icon="Dollar"
        title="Paid"
        meta={daily?.metaSource === "live" ? "Meta live · days in Eastern time" : undefined}
        right={<GoToLink label="Marketing Efficiency" onClick={onOpen} />}
      />
      <Card pad={isMobile ? "8px 4px 12px" : "8px 6px 14px"}>
        {daily == null ? (
          <div style={{ padding: "8px 12px" }}>
            <EmptyState title="Couldn't build the paid summary">
              The Meta and RevenueCat reads both failed. Try Refresh.
            </EmptyState>
          </div>
        ) : (
          <>
            <SummaryTable paid={daily} compact={isMobile} />
            <CampaignTable paid={daily} />
            <div
              style={{
                font: "400 11.5px/1.5 var(--font-ui)",
                color: "var(--ink-3)",
                padding: "12px 14px 0",
              }}
            >
              RevenueCat trials are the real count, from every source, so &ldquo;spend ÷ all trials&rdquo; is
              lower than the true paid cost. Meta&rsquo;s count includes view-through and some organic
              trials, so it can be higher than the real total. Today&rsquo;s numbers are partial and Meta adds
              late conversions for a day or two.
              {notes.map((n) => (
                <div key={n} style={{ color: fam("danger").text, marginTop: 6 }}>
                  {n}
                </div>
              ))}
            </div>
          </>
        )}

        {paid.alerts.length > 0 && (
          <div style={{ display: "grid", gap: 6, margin: "16px 12px 0" }}>
            {paid.alerts.map((a) => {
              const family = a.severity === "critical" ? "danger" : a.severity === "warn" ? "warning" : "info";
              return (
                <div
                  key={a.id}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "flex-start",
                    columnGap: 9,
                    rowGap: 2,
                    padding: "9px 12px",
                    borderRadius: 10,
                    background: fam(family).soft,
                    font: "400 12.5px/1.45 var(--font-ui)",
                    color: fam(family).text,
                  }}
                >
                  <span style={{ fontWeight: 700, minWidth: 0, overflowWrap: "anywhere" }}>{a.campaignName ?? "Account"}</span>
                  <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{a.message}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
