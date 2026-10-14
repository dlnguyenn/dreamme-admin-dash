"use client";

/**
 * Step-down Test tab — is Meta actually driving iOS trials?
 *
 * SCALING iOS was cut from $600 to $200/day on 2026-10-14; this compares
 * RevenueCat trials in the test window against the baseline, with Android
 * and the onboarding survey as controls. All numbers come from one GET
 * /api/step-down-test (src/lib/step-down.ts has the stats and the rules).
 */

import * as React from "react";
import { PageHeader } from "./Shell";
import { Button } from "./ui";
import { Icons } from "./Icons";
import { Card, ErrorBanner, HeroCard, InfoWell, SectionHeader, StatStrip, StatusPill, thStyle } from "./porcelain";
import type { DayRow, StepDownSummary, VerdictStatus } from "@/lib/step-down";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const one = (n: number | null | undefined) => (n == null ? "n/a" : (Math.round(n * 10) / 10).toFixed(1));

const PILL: Record<VerdictStatus, { kind: "running" | "attention" | "neutral" | "success" | "danger"; label: string }> = {
  not_started: { kind: "neutral", label: "Not started" },
  collecting: { kind: "running", label: "Collecting" },
  working: { kind: "success", label: "Meta is working" },
  wasted: { kind: "danger", label: "Spend was wasted" },
  in_between: { kind: "attention", label: "In between" },
};

const td: React.CSSProperties = { padding: "8px 12px", font: "400 13px var(--font-ui)", borderTop: "1px solid var(--line)" };

export function StepDownTest() {
  const [data, setData] = React.useState<{ rows: DayRow[]; summary: StepDownSummary; today: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/step-down-test", { cache: "no-store" });
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

  const s = data?.summary;
  const cfg = s?.config;

  return (
    <div>
      <PageHeader
        eyebrow="Admin / Growth"
        title="Step-down Test"
        subtitle={
          cfg
            ? `${cfg.campaignName} cut from ${usd(cfg.oldDailyBudget)} to ${usd(cfg.newDailyBudget)}/day on ${cfg.transition}. If Meta drives trials, total RevenueCat iOS trials fall. Baseline ${cfg.baseline.from} to ${cfg.baseline.to}, test ${cfg.test.from} to ${cfg.test.to}.`
            : "Is Meta actually driving iOS trials?"
        }
        actions={
          <Button variant="secondary" icon={<Icons.Refresh />} onClick={refresh} disabled={loading}>
            Refresh
          </Button>
        }
      />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {!s && !error && <InfoWell>Loading…</InfoWell>}

      {s && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <StatusPill kind={PILL[s.verdict.status].kind}>{PILL[s.verdict.status].label}</StatusPill>
            <span style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>
              Day {s.daysIn} of {s.daysTotal}
            </span>
          </div>

          <HeroCard
            label="iOS trials/day change"
            value={s.test.days ? `${s.drop >= 0 ? "−" : "+"}${one(Math.abs(s.drop))}` : "Not started"}
            note={
              <>
                <strong>{s.verdict.headline}.</strong> {s.verdict.detail}
              </>
            }
          />

          <div style={{ height: 16 }} />
          <StatStrip
            stats={[
              { label: "iOS trials/day", value: `${one(s.baseline.iosTrials)} → ${s.test.days ? one(s.test.iosTrials) : "…"}`, note: "baseline → test (RevenueCat)" },
              { label: "iOS Meta spend/day", value: `${usd(s.baseline.iosSpend)} → ${s.test.days ? usd(s.test.iosSpend) : "…"}`, note: "all iOS campaigns" },
              { label: "95% range of drop", value: s.test.days ? `${one(s.low)} to ${one(s.high)}` : "…", note: "trials/day" },
              { label: "Cost per lost trial", value: s.costPerLostTrial ? usd(s.costPerLostTrial) : "n/a", note: "spend cut ÷ trials lost" },
              { label: "Android-adjusted drop", value: one(s.dropAndroidAdjusted), note: s.androidChange == null ? "control" : `Android ${s.androidChange >= 0 ? "+" : ""}${Math.round(s.androidChange * 100)}%` },
              {
                label: "Survey: said FB/IG",
                value: s.baseline.iosSurveyMeta == null ? "n/a" : `${one(s.baseline.iosSurveyMeta)} → ${s.test.days ? one(s.test.iosSurveyMeta) : "…"}`,
                note: "iOS trials/day",
              },
            ]}
          />

          <div style={{ height: 24 }} />
          <SectionHeader family="info" icon="Chart" title="Daily" meta="US/Eastern days · today excluded" />
          <Card pad={0} style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Date", "Window", "iOS spend", "iOS trials", "Said FB/IG", "Other answers", "Android spend", "Android trials"].map((h) => (
                    <th key={h} style={thStyle()}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...data!.rows].reverse().map((r) => {
                  const win =
                    r.date === cfg!.transition ? "transition" : r.date >= cfg!.test.from ? (r.date >= data!.today ? "today" : "test") : "baseline";
                  return (
                    <tr key={r.date} style={{ opacity: win === "transition" || win === "today" ? 0.5 : 1 }}>
                      <td style={td}>{r.date}</td>
                      <td style={td}>{win}</td>
                      <td style={td}>{usd(r.iosSpend)}</td>
                      <td style={td}>{r.iosTrials}</td>
                      <td style={td}>{r.iosSurveyMeta ?? "n/a"}</td>
                      <td style={td}>{r.iosSurveyOther ?? "n/a"}</td>
                      <td style={td}>{usd(r.androidSpend)}</td>
                      <td style={td}>{r.androidTrials}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <div style={{ height: 16 }} />
          <InfoWell>
            Rules agreed before the test: a drop of {cfg!.workingDrop}+ iOS trials/day means Meta is driving trials at roughly $23 each;{" "}
            {cfg!.wastedDrop}/day or less means the extra spend was mostly wasted. No verdict before day {cfg!.minDays}. If Android or the
            non-Meta survey answers move a lot too, something other than the budget changed. A daily summary is emailed at 9am ET.
          </InfoWell>
        </>
      )}
    </div>
  );
}
