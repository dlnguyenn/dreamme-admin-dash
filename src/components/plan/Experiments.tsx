"use client";

/**
 * April-plan A/B tests, one block per test: arms with trial counts,
 * trial-to-paid and 30-day revenue per trial net of refunds, the
 * pre-registered stop rule and status. Shown on April Plan > Experiments and
 * under the Pricing Experiments panel. Data: GET /api/plan/experiments (rules
 * in src/lib/revenue-plan/experiments.ts).
 */

import * as React from "react";
import { Card, ErrorBanner, InfoWell, StatusPill, thStyle } from "../porcelain";
import { int, pct, tableCard, tdStyle, usd } from "./format";
import type { ExperimentRead, ExperimentStatus } from "@/lib/revenue-plan/experiments";

const PILL: Record<ExperimentStatus, { kind: "running" | "attention" | "neutral" | "success" | "danger"; label: string }> = {
  draft: { kind: "neutral", label: "Draft" },
  no_data: { kind: "attention", label: "No arms seen" },
  collecting: { kind: "running", label: "Collecting" },
  stop: { kind: "danger", label: "Stop" },
  pass: { kind: "success", label: "Pass" },
  ready: { kind: "success", label: "Ready to read" },
  observing: { kind: "running", label: "Observing" },
};

const signed = (x: number | null, unit: "pct" | "pp") =>
  x == null ? "—" : `${x >= 0 ? "+" : "−"}${(Math.abs(x) * 100).toFixed(1)}${unit === "pct" ? "%" : "pp"}`;

export function Experiments() {
  const [data, setData] = React.useState<ExperimentRead[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/plan/experiments", { cache: "no-store" });
        const body = await res.json();
        if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setData(body.experiments);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (!data) return <InfoWell>Loading experiments…</InfoWell>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {data.map((e) => (
        <Card key={e.def.id} pad={0} style={tableCard}>
          <div style={{ padding: "14px 16px 10px", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ font: "650 14px var(--font-ui)" }}>{e.def.title}</span>
            <span style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>
              {e.def.lever}
              {e.def.start ? ` · since ${e.def.start}` : ""}
            </span>
            <span style={{ marginLeft: "auto" }}>
              <StatusPill kind={PILL[e.status].kind}>{PILL[e.status].label}</StatusPill>
            </span>
          </div>
          <div style={{ padding: "0 16px 10px", font: "400 12.5px var(--font-ui)", color: "var(--ink-2)" }}>{e.message}</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Arm", "Split", "Trials", "Trial-to-paid", "30-day rev / trial", "Net (x0.84)", "vs control", "Rev / install vs control"].map((h, i) => (
                  <th key={h} style={thStyle(i === 0 ? "left" : "right")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {e.def.arms.map((a) => {
                const r = e.arms.find((x) => x.key === a.key);
                return (
                  <tr key={a.key}>
                    <td style={tdStyle("left")}>
                      {a.label}
                      {a.control ? " (control)" : ""}
                    </td>
                    <td style={tdStyle()}>{Math.round(a.share * 100)}%</td>
                    <td style={tdStyle()}>{r ? int(r.trials) : "—"}</td>
                    <td style={tdStyle()} title={r ? `${int(r.payerTrials)} trials 14+ days old` : undefined}>
                      {pct(r?.trialToPaid)}
                    </td>
                    <td style={tdStyle()} title={r ? `${int(r.revTrials)} trials 30+ days old` : undefined}>
                      {usd(r?.rev30PerTrial)}
                    </td>
                    <td style={tdStyle()}>{usd(r?.net30PerTrial)}</td>
                    <td style={tdStyle()}>{a.control ? "" : r ? `${signed(r.revLift, "pct")} · ${signed(r.paidLiftPp, "pp")}` : "—"}</td>
                    <td style={tdStyle()}>{a.control ? "" : signed(r?.enrolledLift ?? null, "pct")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ padding: "10px 16px 14px", font: "400 12px/1.5 var(--font-ui)", color: "var(--ink-3)", borderTop: "1px solid var(--line)" }}>
            <strong style={{ color: "var(--ink-2)" }}>Stop rule:</strong> {e.def.rule.text} Minimum {int(e.def.minTrialsPerArm)} trials per arm.
            {e.unassigned ? ` ${int(e.unassigned)} trials in the window carry no arm.` : ""}
            {e.def.note ? <div style={{ marginTop: 4 }}>{e.def.note}</div> : null}
          </div>
        </Card>
      ))}
      <InfoWell>
        Arms are read from the RevenueCat payloads in rc_events: an RC Experiment's variant, or an app-set subscriber attribute on any of the user's
        events (users seen with two values are dropped). Revenue counts charges plus refunds within 30 days of the trial start, read only from trials
        30+ days old, about two weeks after the day-7 conversion when refunds have posted. Revenue per install is arm revenue divided by its share of
        the split.
      </InfoWell>
    </div>
  );
}
