"use client";

/**
 * Value per trial by source: weekly trial-start cohorts (rc_events) split by
 * the onboarding answer, with payer rate, yearly share, 7/30-day gross revenue
 * and projected 12-month net per trial. The 12-month net is each channel's
 * break-even cost per extra trial. Data: GET /api/plan/value-per-trial
 * (math in src/lib/revenue-plan/value-per-trial.ts).
 */

import * as React from "react";
import { Button } from "../ui";
import { Icons } from "../Icons";
import { Card, ErrorBanner, HeroCard, InfoWell, SectionHeader, Segmented, StatStrip, thStyle } from "../porcelain";
import { TrendChart } from "./TrendChart";
import { int, pct, shortDate, tableCard, tdStyle, usd } from "./format";
import { GROUP_LABEL, META_CPT_RANGE, NET_FACTOR, SOURCE_GROUPS, type SourceGroup } from "@/lib/revenue-plan/sources";
import { WINDOWS, type Cohort, type GroupSummary, type SummaryKey } from "@/lib/revenue-plan/value-per-trial";
import { addDays } from "@/lib/revenue-plan/dates";
import type { ValuePerTrialResponse } from "@/lib/revenue-plan/value-per-trial-data";

const GROUP_COLOR: Record<SourceGroup, string> = {
  meta: "var(--cat-3)",
  tiktok: "var(--cat-1)",
  other: "var(--cat-2)",
};

const SUMMARY_ROWS: { key: SummaryKey; label: string }[] = [
  { key: "meta", label: GROUP_LABEL.meta },
  { key: "tiktok", label: GROUP_LABEL.tiktok },
  { key: "other", label: GROUP_LABEL.other },
  { key: "nonMeta", label: "Non-Meta (TikTok + other)" },
  { key: "all", label: "All trials" },
];

type Win = "latest" | "vault";
type Pick = SourceGroup | "all";

export function ValuePerTrial() {
  const [data, setData] = React.useState<ValuePerTrialResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [win, setWin] = React.useState<Win>("latest");
  const [pick, setPick] = React.useState<Pick>("meta");

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/plan/value-per-trial", { cache: "no-store" });
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
  if (!data) return <InfoWell>Loading cohorts…</InfoWell>;

  const sum = win === "latest" ? data.latest : data.vaultWindow;
  const meta = data.latest.meta;
  const lossPerTrial = meta.net12PerTrial != null ? (META_CPT_RANGE.low + META_CPT_RANGE.high) / 2 - meta.net12PerTrial : null;
  const weeksLabel = (s: GroupSummary) =>
    s.payerWeeks.length ? `${shortDate(s.payerWeeks[0])} to ${shortDate(addDays(s.payerWeeks[s.payerWeeks.length - 1], 6))}` : "no mature weeks";

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        <HeroCard
          label="A Meta trial is worth (12-month net)"
          value={usd(meta.net12PerTrial)}
          note={
            <>
              Trials started {weeksLabel(meta)}. Meta costs {usd(META_CPT_RANGE.low, 0)} to {usd(META_CPT_RANGE.high, 0)} per extra trial (October
              reads){lossPerTrial != null && lossPerTrial > 0 ? `, so each one loses about ${usd(lossPerTrial)}` : ""}. Vault reference{" "}
              {usd(data.reference.meta)}.
            </>
          }
        />
        <StatStrip
          minColWidth={130}
          stats={[
            { label: "TikTok / clippers", value: usd(data.latest.tiktok.net12PerTrial), note: "12-mo net / trial" },
            { label: "Other organic", value: usd(data.latest.other.net12PerTrial), note: "12-mo net / trial" },
            { label: "Non-Meta", value: usd(data.latest.nonMeta.net12PerTrial), note: `vault ${usd(data.reference.nonMeta)}` },
          ]}
        />
      </div>

      <SectionHeader
        family="info"
        icon="Dollar"
        title="Break-even cost per extra trial, by source"
        meta={win === "latest" ? "each metric's latest 6 mature weeks" : "trial weeks Aug 24 to Oct 11 (the vault's window)"}
        right={
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <Segmented
              size="sm"
              value={win}
              onChange={(v) => setWin(v as Win)}
              options={[
                { value: "latest", label: "Latest" },
                { value: "vault", label: "Vault window" },
              ]}
            />
            <Button size="sm" variant="ghost" icon={<Icons.Refresh />} onClick={refresh} disabled={loading}>
              Refresh
            </Button>
          </span>
        }
      />
      <Card pad={0} style={tableCard}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Source", "Trials", "Payer rate", "Yearly share", "7-day rev / trial", "30-day rev / trial", "12-mo net / trial"].map((h, i) => (
                <th key={h} style={thStyle(i === 0 ? "left" : "right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SUMMARY_ROWS.map(({ key, label }) => {
              const s = sum[key];
              const strong = key === "nonMeta" || key === "all";
              return (
                <tr key={key} style={{ background: strong ? "var(--surface-2)" : undefined }}>
                  <td style={{ ...tdStyle("left"), fontWeight: 600 }}>{label}</td>
                  <td style={tdStyle()}>{int(s.payerTrials)}</td>
                  <td style={tdStyle()}>{pct(s.payerRate)}</td>
                  <td style={tdStyle()}>{pct(s.yearlyShare, 0)}</td>
                  <td style={tdStyle()}>{usd(s.rev7PerTrial)}</td>
                  <td style={tdStyle()}>{usd(s.rev30PerTrial)}</td>
                  <td style={{ ...tdStyle(), fontWeight: 650 }}>{usd(s.net12PerTrial)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 16 }}>
        {SOURCE_GROUPS.map((g) => {
          const be = sum[g].net12PerTrial;
          const ref = g === "meta" ? data.reference.meta : data.reference.nonMeta;
          return (
            <Card key={g} pad="14px 16px 10px">
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <span style={{ font: "650 13px var(--font-ui)", color: "var(--ink)" }}>{GROUP_LABEL[g]}</span>
                <span style={{ font: "400 12px var(--font-ui)", color: "var(--ink-3)" }}>pay at most {usd(be)} per extra trial</span>
              </div>
              <TrendChart
                ariaLabel={`${GROUP_LABEL[g]}: projected 12-month net per trial by trial week`}
                color={GROUP_COLOR[g]}
                format={(v) => usd(v, 0)}
                points={data.series[g].map((p) => ({ x: p.week, y: p.value, note: `${int(p.trials)} trials` }))}
                refs={[
                  ...(be != null ? [{ y: be, label: `break-even ${usd(be)}` }] : []),
                  { y: ref, label: `vault ${usd(ref)}`, dashed: true },
                ]}
                band={
                  g === "meta"
                    ? { y0: META_CPT_RANGE.low, y1: META_CPT_RANGE.high, label: `Meta cost ${usd(META_CPT_RANGE.low, 0)}-${META_CPT_RANGE.high}` }
                    : undefined
                }
                yFloor={null}
              />
            </Card>
          );
        })}
      </div>

      <SectionHeader
        family="neutral"
        icon="Grid"
        title="Weekly cohorts"
        meta="trial-start week (Mon-Sun, US/Eastern) · … = not mature yet"
        right={
          <Segmented
            size="sm"
            value={pick}
            onChange={(v) => setPick(v as Pick)}
            options={[
              { value: "meta", label: "Meta" },
              { value: "tiktok", label: "TikTok" },
              { value: "other", label: "Other" },
              { value: "all", label: "All" },
            ]}
          />
        }
      />
      <CohortTable cohorts={data.cohorts} pick={pick} />

      <div style={{ height: 16 }} />
      <InfoWell>
        Revenue is gross price of every charge by the trial's user (subscriptions and pearls), refunds not deducted; it reproduces the vault's
        rc_events read (September 30-day $14.40 vs $14.41). "7-day" counts charges within {WINDOWS.d7} days of the trial start, because the 7-day
        trial converts at 7.0 to 7.5 days. A payer is a trial with a subscription charge within {WINDOWS.payer} days; the 12-month projection is that
        first charge x 3.4 payments for monthly, x2 quarterly, x1 yearly, then x{NET_FACTOR} for Apple's 15% and tax. Unmatched trials (no user row):{" "}
        {int(data.unmatchedTrials)} of {int(data.totalTrials)}; they count only in All.
      </InfoWell>
    </div>
  );
}

function CohortTable({ cohorts, pick }: { cohorts: Cohort[]; pick: Pick }) {
  const weeks = [...new Set(cohorts.map((c) => c.week))].sort().reverse();
  const rows = weeks.map((w) => {
    const cells = cohorts.filter((c) => c.week === w && (pick === "all" || c.group === pick));
    const add = (f: (c: Cohort) => number) => cells.reduce((s, c) => s + f(c), 0);
    const first = cells[0];
    return {
      week: w,
      trials: add((c) => c.trials),
      payers: add((c) => c.payers),
      yearly: add((c) => c.yearlyPayers),
      rev7: add((c) => c.rev7),
      rev30: add((c) => c.rev30),
      proj: add((c) => c.proj12Gross),
      complete: first?.complete ?? false,
      payersMature: first?.payersMature ?? false,
      d7Mature: first?.d7Mature ?? false,
      d30Mature: first?.d30Mature ?? false,
    };
  });
  const pending = (days: number, w: string) => (
    <span title={`Matures after ${shortDate(addDays(w, 6 + days))}`} style={{ color: "var(--ink-4)" }}>
      …
    </span>
  );
  return (
    <Card pad={0} style={tableCard}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Week of", "Trials", "Payer rate", "Yearly share", "7-day rev / trial", "30-day rev / trial", "12-mo net / trial"].map((h, i) => (
              <th key={h} style={thStyle(i === 0 ? "left" : "right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.week} style={{ opacity: r.complete ? 1 : 0.6 }}>
              <td style={tdStyle("left")}>
                {shortDate(r.week)}
                {r.complete ? "" : " (in progress)"}
              </td>
              <td style={tdStyle()}>{int(r.trials)}</td>
              <td style={tdStyle()}>{r.payersMature ? pct(r.trials ? r.payers / r.trials : null) : pending(WINDOWS.payer, r.week)}</td>
              <td style={tdStyle()}>{r.payersMature ? pct(r.payers ? r.yearly / r.payers : null, 0) : pending(WINDOWS.payer, r.week)}</td>
              <td style={tdStyle()}>{r.d7Mature ? usd(r.trials ? r.rev7 / r.trials : null) : pending(WINDOWS.d7, r.week)}</td>
              <td style={tdStyle()}>{r.d30Mature ? usd(r.trials ? r.rev30 / r.trials : null) : pending(WINDOWS.d30, r.week)}</td>
              <td style={{ ...tdStyle(), fontWeight: 600 }}>
                {r.payersMature ? usd(r.trials ? (r.proj / r.trials) * NET_FACTOR : null) : pending(WINDOWS.payer, r.week)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
