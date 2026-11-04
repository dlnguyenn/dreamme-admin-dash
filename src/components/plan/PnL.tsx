"use client";

/**
 * April Plan > P&L: monthly contribution. Proceeds at Apple's real 15%
 * (gross x0.84) minus Meta, creators and tools; other Chase costs listed under
 * it. Creators and tools come from the Chase alert feed, so a month without
 * Chase rows stops at proceeds minus Meta. Data: GET /api/plan/scorecard
 * (rules in src/lib/revenue-plan/pnl.ts).
 */

import * as React from "react";
import { Card, ErrorBanner, InfoWell, SectionHeader, thStyle } from "../porcelain";
import { tableCard, tdStyle, usd } from "./format";
import type { ScorecardResponse } from "@/lib/revenue-plan/scorecard-data";

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export function PnL() {
  const [data, setData] = React.useState<ScorecardResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/plan/scorecard", { cache: "no-store" });
        const body = await res.json();
        if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setData(body);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (!data) return <InfoWell>Loading the P&L…</InfoWell>;

  const neg = (n: number | null) => (n == null ? "—" : n === 0 ? "$0" : `−${usd(n, 0)}`);
  const money = (n: number | null) => (
    <span style={{ color: n != null && n < 0 ? "var(--danger-text)" : undefined, fontWeight: 650 }}>{usd(n, 0)}</span>
  );

  return (
    <div>
      {data.chase.note && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            background: "var(--attention-soft)",
            color: "var(--attention-text)",
            borderRadius: 10,
            font: "400 13px var(--font-ui)",
          }}
        >
          {data.chase.note}
        </div>
      )}
      <SectionHeader family="info" icon="Dollar" title="Monthly contribution" meta="proceeds at 15% minus Meta, creators and tools" style={{ marginTop: 0 }} />
      <Card pad={0} style={tableCard}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Month", "Gross", "Proceeds (x0.84)", "Meta", "Creators", "Tools", "Contribution", "Proceeds − Meta", "Other costs"].map((h, i) => (
                <th key={h} style={thStyle(i === 0 ? "left" : "right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...data.pnl].reverse().map((p) => (
              <tr key={p.month} style={{ opacity: p.partial ? 0.7 : 1 }}>
                <td style={tdStyle("left")}>
                  {monthLabel(p.month)}
                  {p.partial ? " (to date)" : ""}
                </td>
                <td style={tdStyle()}>{usd(p.gross, 0)}</td>
                <td style={tdStyle()}>{usd(p.proceeds, 0)}</td>
                <td style={tdStyle()}>{neg(p.meta)}</td>
                <td style={tdStyle()} title={p.creatorsBasis === "manual" ? "hand-entered clipper weeks; no Chase rows this month" : undefined}>
                  {neg(p.creators)}
                  {p.creatorsBasis === "manual" ? " *" : ""}
                </td>
                <td style={tdStyle()}>{neg(p.tools)}</td>
                <td style={tdStyle()}>{p.contribution == null ? <span style={{ color: "var(--ink-4)" }}>needs Chase</span> : money(p.contribution)}</td>
                <td style={tdStyle()}>{money(p.afterMeta)}</td>
                <td style={tdStyle()}>{neg(p.other)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div style={{ height: 16 }} />
      <InfoWell>
        Gross is rc_events charges minus refunds; proceeds are gross x0.84 (Apple's Small Business 15% plus ~1% tax, confirmed from deposits), never
        RC's proceeds, which assume ~29.5%. Meta is the ad account's spend (ad_insights_daily). Creators are Chase's Whop, contractor and person-to-person
        payments; * marks a month read from the hand-entered clipper weeks instead. Tools are AI, infra, data, content tooling, analytics and software.
        Other costs (legal, bank fees, uncategorised) sit outside the contribution. Chase months covered: {data.chase.covered.length ? data.chase.covered.join(", ") : "none yet"}.
      </InfoWell>
    </div>
  );
}
