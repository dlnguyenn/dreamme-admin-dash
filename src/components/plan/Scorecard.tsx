"use client";

/**
 * April Plan > Scorecard: month-to-date gross against the plan forecast, the
 * gap to $100k in April, the Jan 15 checkpoints and model drift (red when the
 * forecast misses actual gross by more than 10%). Data: GET /api/plan/scorecard
 * (model in src/lib/revenue-plan/forecast.ts, a port of the vault's v2 script).
 */

import * as React from "react";
import { Button } from "../ui";
import { Icons } from "../Icons";
import { Card, ErrorBanner, HeroCard, InfoWell, SectionHeader, StatStrip, StatusPill, thStyle } from "../porcelain";
import { TrendChart } from "./TrendChart";
import { int, pct, tableCard, tdStyle, usd } from "./format";
import type { Checkpoint, ScorecardResponse } from "@/lib/revenue-plan/scorecard-data";

const monthLabel = (m: string) =>
  new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const k = (n: number | null | undefined) => (n == null ? "—" : `$${(n / 1000).toFixed(1)}k`);
const signedPct = (x: number | null) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${(Math.abs(x) * 100).toFixed(1)}%`);

const CP_PILL: Record<Checkpoint["status"], { kind: "success" | "danger" | "neutral"; label: string }> = {
  pass: { kind: "success", label: "On track" },
  fail: { kind: "danger", label: "Missed" },
  pending: { kind: "neutral", label: "Pending" },
};

export function Scorecard() {
  const [data, setData] = React.useState<ScorecardResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/plan/scorecard", { cache: "no-store" });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (!data) return <InfoWell>Loading the scorecard…</InfoWell>;

  const red = (x: number | null) => x != null && Math.abs(x) > data.driftRed;
  const cp = data.checkpoint;
  const drifting = data.months.filter((m) => red(m.planErr) || red(m.modelErr));

  return (
    <div>
      {(cp.missed || drifting.length > 0 || red(data.mtd.drift)) && (
        <ErrorBanner>
          {cp.missed && <div>A Jan 15 checkpoint was missed: reset the April target to about {k(cp.resetTarget)}.</div>}
          {drifting.map((m) => (
            <div key={m.month}>
              Model drift in {monthLabel(m.month)}: forecast {signedPct(m.planErr)} vs actual gross. Fix the model's inputs before acting on it.
            </div>
          ))}
          {red(data.mtd.drift) && <div>This month is running {signedPct(data.mtd.drift)} against the plan forecast.</div>}
        </ErrorBanner>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        <HeroCard
          label="April 2027 gross, current path"
          value={k(data.april.live)}
          delta={`${k(data.april.gap)} short of ${k(data.april.target)}`}
          deltaUp={data.april.gap <= 0}
          note={
            <>
              The plan baseline (frozen Nov 4) was {k(data.april.plan)}. This re-runs the same model on this month's real trials and Meta share,
              held flat to April.
            </>
          }
        />
        <StatStrip
          minColWidth={140}
          stats={[
            {
              label: `${monthLabel(data.month)} to date`,
              value: k(data.mtd.actual),
              delta: signedPct(data.mtd.drift),
              deltaFamily: red(data.mtd.drift) ? "danger" : (data.mtd.drift ?? 0) >= 0 ? "success" : "warning",
              note: `vs ${k(data.mtd.planToDate)} plan to date`,
            },
            { label: "Month at this pace", value: k(data.mtd.projected), note: `plan ${k(data.mtd.planMonth)}` },
            { label: "Jan 15 checkpoint", value: cp.daysLeft > 0 ? `${cp.daysLeft} days` : "due", note: `else reset target to ${k(cp.resetTarget)}` },
          ]}
        />
      </div>

      <SectionHeader
        family="info"
        icon="Flag"
        title="Jan 15 checkpoints"
        meta="both must hold, or April resets to ~$80k"
        right={
          <Button size="sm" variant="ghost" icon={<Icons.Refresh />} onClick={refresh} disabled={loading}>
            Refresh
          </Button>
        }
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        <CheckpointCard title="Clippers at $15 or less per extra trial" c={cp.clipper} />
        <CheckpointCard title="Pricing test at +10% or better revenue per trial" c={cp.pricing} />
      </div>

      <SectionHeader family="neutral" icon="Trend" title="Forecast to April" meta="model v2 on real trials; dashed = $100k target" />
      <Card pad="14px 16px 10px">
        <TrendChart
          ariaLabel="Monthly gross forecast to May 2027"
          color="var(--cat-3)"
          format={(v) => k(v)}
          xLabel={monthLabel}
          points={data.forecast.map((f) => ({ x: `${f.month}-01`, y: f.live, note: `plan baseline ${k(f.plan)}` }))}
          refs={[
            { y: data.april.target, label: "target $100k", dashed: true },
            { y: data.april.plan, label: `Apr plan ${k(data.april.plan)}` },
          ]}
          yFloor={0}
          height={190}
        />
      </Card>

      <SectionHeader family="neutral" icon="Chart" title="Model drift" meta={`red when the forecast misses actual gross by more than ${Math.round(data.driftRed * 100)}%`} />
      <Card pad={0} style={tableCard}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Month", "Actual gross", "Plan forecast", "Plan error", "Model on real trials", "Model error", "Trials", "Meta share"].map((h, i) => (
                <th key={h} style={thStyle(i === 0 ? "left" : "right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...data.months].reverse().map((m) => {
              const input = data.inputs.find((x) => x.month === m.month);
              return (
                <tr key={m.month}>
                  <td style={tdStyle("left")}>
                    {monthLabel(m.month)}
                    {m.complete ? "" : " (to date)"}
                  </td>
                  <td style={tdStyle()}>{usd(m.actual, 0)}</td>
                  <td style={tdStyle()}>{usd(m.plan, 0)}</td>
                  <td style={{ ...tdStyle(), color: red(m.planErr) ? "var(--danger-text)" : undefined, fontWeight: red(m.planErr) ? 650 : 400 }}>{signedPct(m.planErr)}</td>
                  <td style={tdStyle()}>{usd(m.model, 0)}</td>
                  <td style={{ ...tdStyle(), color: red(m.modelErr) ? "var(--danger-text)" : undefined, fontWeight: red(m.modelErr) ? 650 : 400 }}>{signedPct(m.modelErr)}</td>
                  <td style={tdStyle()}>
                    {int(input?.trials)}
                    {input?.source === "projected" ? " (pace)" : ""}
                  </td>
                  <td style={tdStyle()}>{pct(input?.metaShare, 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <SectionHeader family="neutral" icon="Grid" title="What reaches $100k" meta="April gross by value-per-trial lift and extra clipper trials/month by March (Meta held at ~1,100 trials)" />
      <Card pad={0} style={tableCard}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle("left")}>Value per trial</th>
              {[...new Set(data.grid.map((g) => g.extra))].map((e) => (
                <th key={e} style={thStyle()}>
                  +{e.toLocaleString("en-US")} trials/mo
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...new Set(data.grid.map((g) => g.lift))].map((lift) => (
              <tr key={lift}>
                <td style={tdStyle("left")}>{lift === 1 ? "Today" : `+${Math.round((lift - 1) * 100)}%`}</td>
                {data.grid
                  .filter((g) => g.lift === lift)
                  .map((g) => (
                    <td
                      key={g.extra}
                      style={{
                        ...tdStyle(),
                        fontWeight: g.april >= data.april.target ? 650 : 400,
                        color: g.april >= data.april.target ? "var(--success-text)" : undefined,
                      }}
                    >
                      {k(g.april)}
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div style={{ height: 16 }} />
      <InfoWell>
        Actual gross is rc_events charges minus refunds by UTC month (within 0.5% of RevenueCat's "Revenue" for Aug-Oct). The plan forecast is the
        vault's model v2 status quo frozen on 2026-11-04 (wiki/data/revenue-model-v2-2026-11-04.py, ported in src/lib/revenue-plan/forecast.ts). This
        month's trials are projected from its pace so far, which is noisy in the first days.
      </InfoWell>
    </div>
  );
}

function CheckpointCard({ title, c }: { title: string; c: Checkpoint }) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ font: "650 13px var(--font-ui)" }}>{title}</span>
        <StatusPill kind={CP_PILL[c.status].kind}>{CP_PILL[c.status].label}</StatusPill>
      </div>
      <div style={{ font: "700 22px var(--font-ui)", margin: "10px 0 4px", fontVariantNumeric: "tabular-nums" }}>{c.value}</div>
      <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>{c.note}</div>
    </Card>
  );
}
