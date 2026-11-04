"use client";

/**
 * Meta Switchback tab (?tab=stepdown): config-driven Meta holdout tests.
 *
 * Each test is a table of phases with the planned daily budget per campaign
 * (src/lib/revenue-plan/switchback.ts). This screen shows spend against that
 * plan every day (the October step-down broke on day 3 and nobody saw it),
 * RevenueCat iOS trials against Android as the control, Meta's own trial
 * count against all trials, and the running incremental cost per trial with
 * its 90% interval, judged against a Meta trial's 12-month net value.
 * All numbers come from one GET /api/switchback?test=<id>.
 */

import * as React from "react";
import { PageHeader } from "./Shell";
import { Button } from "./ui";
import { Icons } from "./Icons";
import { Card, ErrorBanner, HeroCard, InfoWell, SectionHeader, Segmented, StatStrip, StatusPill, thStyle } from "./porcelain";
import { TrendChart } from "./plan/TrendChart";
import { int, one, pct, shortDate, tableCard, tdStyle, usd } from "./plan/format";
import {
  CRITICAL_DEVIATION,
  WARN_DEVIATION,
  ZERO_PLAN_TOLERANCE,
  phaseOf,
  type SwitchbackDay,
  type SwitchbackSummary,
  type VerdictStatus,
} from "@/lib/revenue-plan/switchback";
import type { SourceStatus } from "@/lib/revenue-plan/user-sources";

const PILL: Record<VerdictStatus, { kind: "running" | "attention" | "neutral" | "success" | "danger"; label: string }> = {
  draft: { kind: "neutral", label: "Draft" },
  not_started: { kind: "neutral", label: "Not started" },
  collecting: { kind: "running", label: "Collecting" },
  invalid: { kind: "danger", label: "No read" },
  keep_high: { kind: "success", label: "Keep high" },
  run_low: { kind: "danger", label: "Run low" },
  extend: { kind: "attention", label: "Extend" },
};

interface Payload {
  tests: { id: string; title: string; status: string; from: string }[];
  today: string;
  days: SwitchbackDay[];
  names: Record<string, string>;
  platforms: Record<string, "ios" | "android">;
  sources: SourceStatus | null;
  summary: SwitchbackSummary;
}

/** Deviation of actual from planned spend, as the plan check scores it. */
function offPlan(planned: number, actual: number): "ok" | "warn" | "critical" {
  if (planned === 0) return actual > ZERO_PLAN_TOLERANCE ? "critical" : "ok";
  const dev = Math.abs(actual - planned) / planned;
  return dev > CRITICAL_DEVIATION ? "critical" : dev > WARN_DEVIATION ? "warn" : "ok";
}
const OFF_COLOR = { ok: "var(--ink)", warn: "var(--warning-text)", critical: "var(--danger-text)" } as const;

export function SwitchbackTest() {
  const [testId, setTestId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<Payload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async (id: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/switchback${id ? `?test=${encodeURIComponent(id)}` : ""}`, { cache: "no-store" });
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
    void refresh(testId);
  }, [refresh, testId]);

  const s = data?.summary;
  const t = s?.test;

  return (
    <div>
      <PageHeader
        eyebrow="Admin / Growth"
        title="Meta Switchback"
        subtitle={t ? t.summary : "Is Meta buying trials it can pay back?"}
        actions={
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {data && data.tests.length > 1 && (
              <Segmented
                size="sm"
                value={t?.id ?? ""}
                onChange={(v) => setTestId(v)}
                options={data.tests.map((x) => ({ value: x.id, label: `${x.title}${x.status === "draft" ? " (draft)" : ""}` }))}
              />
            )}
            <Button variant="secondary" icon={<Icons.Refresh />} onClick={() => refresh(testId)} disabled={loading}>
              Refresh
            </Button>
          </span>
        }
      />
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {!s && !error && <InfoWell>Loading…</InfoWell>}
      {s && t && data && <Body data={data} s={s} />}
    </div>
  );
}

function Body({ data, s }: { data: Payload; s: SwitchbackSummary }) {
  const t = s.test;
  const planned = t.campaigns;
  const critical = s.deviations.filter((d) => d.severity === "critical");
  const warn = s.deviations.filter((d) => d.severity === "warn");
  const inTest = data.days.filter((d) => d.date < data.today && phaseOf(t, d.date));
  const recent = data.days.filter((d) => d.date < data.today).slice(-7);
  const avg = (rows: SwitchbackDay[], f: (d: SwitchbackDay) => number) => (rows.length ? rows.reduce((a, d) => a + f(d), 0) / rows.length : null);
  const armLabel = (d: SwitchbackDay) => {
    const p = phaseOf(t, d.date);
    if (d.date >= data.today) return "today";
    if (p) return p.arm;
    if (t.excludeDays?.includes(d.date)) return "excluded";
    if (d.date < t.phases[0].from) return "pre-test";
    return d.date > t.phases[t.phases.length - 1].to ? "after" : "transition";
  };
  const shade = t.phases.map((p) => ({ from: p.from, to: p.to, label: p.arm === "high" ? "HIGH" : "LOW" }));
  const p = s.primary;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <StatusPill kind={PILL[s.verdict.status].kind}>{PILL[s.verdict.status].label}</StatusPill>
        <span style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>
          {t.phases[0].from} to {t.phases[t.phases.length - 1].to} · {s.daysIn} of {s.daysTotal} test days counted
        </span>
      </div>

      {(critical.length > 0 || warn.length > 0) && (
        <div
          style={{
            marginBottom: 16,
            padding: "12px 16px",
            background: critical.length ? "var(--danger-soft)" : "var(--warning-soft)",
            color: critical.length ? "var(--danger-text)" : "var(--warning-text)",
            borderRadius: 12,
            font: "400 13px/1.5 var(--font-ui)",
          }}
        >
          <div style={{ font: "650 13px var(--font-ui)", marginBottom: 4 }}>
            Spend off plan on {critical.length + warn.length} campaign-day{critical.length + warn.length === 1 ? "" : "s"}
            {critical.length ? ` (${critical.length} more than ${Math.round(CRITICAL_DEVIATION * 100)}% off)` : ""}
            {critical.length ? `, first on ${shortDate(critical[0].date)}` : ""}
          </div>
          {[...critical, ...warn]
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(0, 6)
            .map((d) => (
              <div key={`${d.date}${d.campaignId}`}>{d.message}</div>
            ))}
          {critical.length + warn.length > 6 && <div>…and {critical.length + warn.length - 6} more in the daily table.</div>}
          <div style={{ marginTop: 4, opacity: 0.85 }}>
            {t.status === "live" ? "Each one is also a marketing_alerts row." : "Live tests also raise a marketing_alerts row for each."}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        <HeroCard
          label="Cost per extra iOS trial"
          value={s.cpt != null ? usd(s.cpt) : t.status === "draft" ? "Not started" : "—"}
          delta={s.cpt != null ? `90% ${usd(s.cptLow)} to ${s.cptHigh != null ? usd(s.cptHigh) : "unbounded"}` : undefined}
          deltaUp={s.cpt != null && s.cpt <= s.breakEven.value}
          note={
            <>
              <strong>{s.verdict.headline}.</strong> {s.verdict.detail}
            </>
          }
        />
        <StatStrip
          minColWidth={140}
          stats={[
            { label: "iOS trials/day", value: s.high.days ? `${one(s.high.iosTrials)} / ${s.low.days ? one(s.low.iosTrials) : "…"}` : "…", note: "high / low arm (RC)" },
            {
              label: "iOS spend/day",
              value: s.high.days ? `${usd(s.high.iosSpend, 0)} / ${s.low.days ? usd(s.low.iosSpend, 0) : "…"}` : "…",
              note: s.plannedSpendDelta != null ? `gap ${usd(s.spendDelta, 0)} vs ${usd(s.plannedSpendDelta, 0)} planned` : "high / low arm",
            },
            { label: "Extra trials/day", value: p ? one(p.effect) : "…", note: p ? `90% ${one(p.low90)} to ${one(p.high90)}` : "needs 2+ days per arm" },
            { label: "Break-even", value: usd(s.breakEven.value), note: "Meta trial, 12-mo net" },
          ]}
        />
      </div>
      <div style={{ height: 16 }} />
      <StatStrip
        stats={[
          {
            label: "Android trials/day",
            value: s.high.days ? `${one(s.high.androidTrials)} / ${s.low.days ? one(s.low.androidTrials) : "…"}` : "…",
            note: "control, high / low arm",
          },
          {
            label: "Meta-reported iOS trials/day",
            value: s.high.days ? `${one(s.high.iosMetaReported)} / ${s.low.days ? one(s.low.iosMetaReported) : "…"}` : "…",
            note: s.high.days && s.high.iosTrials ? `Meta claims ${pct(s.high.iosMetaReported / s.high.iosTrials, 0)} of all iOS trials (high)` : "Meta's own count",
          },
          {
            label: "Said FB/IG, iOS trials/day",
            value: s.high.iosSaidMeta != null ? `${one(s.high.iosSaidMeta)} / ${s.low.iosSaidMeta != null ? one(s.low.iosSaidMeta) : "…"}` : "n/a",
            note: "onboarding survey, high / low",
          },
          {
            label: "Estimate",
            value: p ? (p.method === "android-adjusted" ? "Android-adjusted" : "Raw") : "…",
            note: s.raw && s.adjusted ? `raw ${one(s.raw.effect)} vs adjusted ${one(s.adjusted.effect)}` : "OLS with Android trials",
          },
        ]}
      />

      <SectionHeader family="info" icon="Dollar" title="Spend against plan" meta="planned $/day vs actual average, per phase" />
      <Card pad={0} style={tableCard}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle("left")}>Phase</th>
              {planned.map((c) => (
                <th key={c.id} style={thStyle()}>
                  {c.name.replace(/ Campaign| website/g, "")}
                </th>
              ))}
              <th style={thStyle()}>Days off plan</th>
            </tr>
          </thead>
          <tbody>
            {t.phases.map((ph) => {
              const rows = inTest.filter((d) => d.date >= ph.from && d.date <= ph.to);
              const off = new Set(s.deviations.filter((d) => d.date >= ph.from && d.date <= ph.to).map((d) => d.date)).size;
              return (
                <tr key={ph.from}>
                  <td style={tdStyle("left")}>
                    <strong>{ph.arm === "high" ? "High" : "Low"}</strong> {shortDate(ph.from)} to {shortDate(ph.to)}
                    {ph.observed ? " (status quo)" : ""}
                  </td>
                  {planned.map((c) => {
                    const plan = ph.budgets[c.id];
                    const actual = avg(rows, (d) => d.spend[c.id] ?? 0);
                    const state = !ph.observed && plan != null && actual != null ? offPlan(plan, actual) : "ok";
                    return (
                      <td key={c.id} style={tdStyle()}>
                        <span style={{ color: "var(--ink-3)" }}>{plan != null ? usd(plan, 0) : "not in plan"}</span>
                        {" → "}
                        <span style={{ color: OFF_COLOR[state], fontWeight: state === "ok" ? 400 : 650 }}>{actual != null ? usd(actual, 0) : "…"}</span>
                      </td>
                    );
                  })}
                  <td style={tdStyle()}>{ph.observed ? "not checked" : rows.length ? `${off} of ${rows.length}` : "…"}</td>
                </tr>
              );
            })}
            {t.status === "draft" && (
              <tr style={{ background: "var(--surface-2)" }}>
                <td style={tdStyle("left")}>Now (last {recent.length} days)</td>
                {planned.map((c) => (
                  <td key={c.id} style={tdStyle()}>
                    {usd(avg(recent, (d) => d.spend[c.id] ?? 0), 0)}
                  </td>
                ))}
                <td style={tdStyle()}>pre-flight</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginTop: 16 }}>
        <Card pad="14px 16px 10px">
          <div style={{ font: "650 13px var(--font-ui)", marginBottom: 6 }}>iOS trials per day (RevenueCat)</div>
          <TrendChart
            ariaLabel="iOS trials per day"
            color="var(--cat-3)"
            format={(v) => int(v)}
            points={data.days.map((d) => ({
              x: d.date,
              y: d.date < data.today ? d.iosTrials : null,
              note: `${usd(d.iosSpend, 0)} iOS spend · Meta says ${int(d.iosMetaReported)}`,
            }))}
            shade={shade}
          />
        </Card>
        <Card pad="14px 16px 10px">
          <div style={{ font: "650 13px var(--font-ui)", marginBottom: 6 }}>Android trials per day (control)</div>
          <TrendChart
            ariaLabel="Android trials per day"
            color="var(--cat-1)"
            format={(v) => int(v)}
            points={data.days.map((d) => ({ x: d.date, y: d.date < data.today ? d.androidTrials : null, note: `${usd(d.androidSpend, 0)} Android spend` }))}
            shade={shade}
          />
        </Card>
      </div>

      <SectionHeader family="neutral" icon="Chart" title="Daily" meta="US/Eastern days · today excluded" />
      <Card pad={0} style={tableCard}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Date", "Arm", ...planned.map((c) => c.name.replace(/ Campaign| website/g, "")), "Other spend", "iOS trials", "Meta says (iOS)", "Said FB/IG", "Other answers", "Android trials"].map(
                (h, i) => (
                  <th key={h} style={thStyle(i < 2 ? "left" : "right")}>
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {[...data.days].reverse().map((d) => {
              const ph = phaseOf(t, d.date);
              const arm = armLabel(d);
              const otherSpend = Object.entries(d.spend)
                .filter(([id]) => !planned.some((c) => c.id === id))
                .reduce((a, [, v]) => a + v, 0);
              return (
                <tr key={d.date} style={{ opacity: arm === "today" || arm === "excluded" || arm === "transition" ? 0.5 : 1 }}>
                  <td style={tdStyle("left")}>{d.date}</td>
                  <td style={tdStyle("left")}>{arm}</td>
                  {planned.map((c) => {
                    const v = d.spend[c.id] ?? 0;
                    const plan = ph?.budgets[c.id];
                    const state = ph && !ph.observed && plan != null && d.date < data.today ? offPlan(plan, v) : "ok";
                    return (
                      <td key={c.id} style={{ ...tdStyle(), color: OFF_COLOR[state], fontWeight: state === "ok" ? 400 : 650 }} title={plan != null ? `plan ${usd(plan, 0)}` : undefined}>
                        {usd(v, 0)}
                      </td>
                    );
                  })}
                  <td style={{ ...tdStyle(), color: ph && !ph.observed && otherSpend > ZERO_PLAN_TOLERANCE ? OFF_COLOR.warn : undefined }}>{usd(otherSpend, 0)}</td>
                  <td style={tdStyle()}>{d.iosTrials}</td>
                  <td style={tdStyle()}>{d.iosMetaReported}</td>
                  <td style={tdStyle()}>{d.iosSaidMeta ?? "n/a"}</td>
                  <td style={tdStyle()}>{d.iosSaidOther ?? "n/a"}</td>
                  <td style={tdStyle()}>{d.androidTrials}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div style={{ height: 16 }} />
      <InfoWell>
        Rule (pre-registered in the vault): keep the high spend only if the incremental cost per trial is at or below a Meta trial's 12-month net
        value ({usd(s.breakEven.value)}, {s.breakEven.basis}). Otherwise run low, then test $0 for a week. Extend {t.extendWeeks} weeks if the 90%
        interval is wider than +/-{Math.round(t.maxRelHalfWidth * 100)}% of the effect, unless the whole interval already sits on one side of
        break-even. The effect is iOS trials/day high vs low, adjusted for Android trials/day (Android's spend never changes). Spend more than{" "}
        {Math.round(WARN_DEVIATION * 100)}% off plan is flagged (red over {Math.round(CRITICAL_DEVIATION * 100)}%, or any spend on a campaign planned at $0).
        {t.notes?.length ? (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {t.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
        {data.sources?.note ? <div style={{ marginTop: 6 }}>{data.sources.note}</div> : null}
      </InfoWell>
    </>
  );
}
