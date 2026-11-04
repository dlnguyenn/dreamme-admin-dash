"use client";

/**
 * Clipper tracker: weekly pay-per-view clipper spend (entered by hand; Content
 * Rewards / Whop has no API) against TikTok-sourced onboardings and trials,
 * the cost per extra trial, and the tranche stop rule (pause above $18 two
 * weeks running, double at $15 or less). Data: /api/plan/clipper-tracker
 * (rules in src/lib/revenue-plan/clipper-tracker.ts).
 */

import * as React from "react";
import { Button, useToast } from "../ui";
import { Icons } from "../Icons";
import { Card, ErrorBanner, InfoWell, SectionHeader, StatStrip, StatusPill, thStyle } from "../porcelain";
import { TrendChart } from "./TrendChart";
import { int, one, shortDate, signed, tableCard, tdStyle, usd } from "./format";
import { addDays } from "@/lib/revenue-plan/dates";
import type { StopStatus, TrackerWeek } from "@/lib/revenue-plan/clipper-tracker";
import type { ClipperTrackerResponse } from "@/lib/revenue-plan/clipper-tracker-data";

const STATUS: Record<StopStatus, { kind: "running" | "attention" | "neutral" | "success" | "danger"; label: string }> = {
  no_spend: { kind: "neutral", label: "No spend" },
  pending: { kind: "neutral", label: "Week in progress" },
  no_lift: { kind: "attention", label: "No lift" },
  double: { kind: "success", label: "Double the tranche" },
  hold: { kind: "neutral", label: "Hold" },
  over: { kind: "attention", label: "Over $18" },
  pause: { kind: "danger", label: "Pause" },
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  fontFamily: "var(--font-ui)",
  fontVariantNumeric: "tabular-nums",
  border: "1px solid var(--line-2)",
  borderRadius: 9,
  background: "var(--surface)",
  color: "var(--ink)",
  outline: "none",
};

interface Draft {
  weekStart: string;
  viewsBought: string;
  payoutsUsd: string;
  feesUsd: string;
  tranche: string;
  note: string;
}

const draftFor = (w: TrackerWeek): Draft => ({
  weekStart: w.week,
  viewsBought: w.entry?.viewsBought != null ? String(w.entry.viewsBought) : "",
  payoutsUsd: w.entry ? String(w.entry.payoutsUsd) : "",
  feesUsd: w.entry ? String(w.entry.feesUsd) : "",
  tranche: w.entry?.tranche ?? "",
  note: w.entry?.note ?? "",
});

export function ClipperTracker() {
  const toast = useToast();
  const [data, setData] = React.useState<ClipperTrackerResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [saving, setSaving] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/plan/clipper-tracker", { cache: "no-store" });
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

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/plan/clipper-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast(`Saved week of ${shortDate(draft.weekStart)}`);
      setDraft(null);
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/plan/clipper-tracker?week=${draft.weekStart}`, { method: "DELETE" });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setDraft(null);
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (!data) return <InfoWell>Loading clipper weeks…</InfoWell>;

  const b = data.baseline;
  const call = data.call;
  const weeks = [...data.weeks].reverse();
  const totalSpend = data.weeks.reduce((s, w) => s + w.spend, 0);
  const lastComplete = [...data.weeks].reverse().find((w) => w.complete);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <StatusPill kind={call ? STATUS[call.status].kind : "neutral"}>{call ? STATUS[call.status].label : "No spend logged"}</StatusPill>
        <span style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>
          {call
            ? `Week of ${shortDate(call.week)}: ${usd(call.spend)} for ${signed(call.extraNonMetaTrials)} extra non-Meta trials${call.costPerExtraTrial != null ? ` (${usd(call.costPerExtraTrial)} each)` : ""}.`
            : "Log the first tranche week below; the rule reads each complete week with spend."}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <Button size="sm" variant="ghost" icon={<Icons.Refresh />} onClick={refresh} disabled={loading}>
            Refresh
          </Button>
        </span>
      </div>

      <StatStrip
        stats={[
          {
            label: "Baseline TikTok onboardings",
            value: b ? `${int(b.tiktokOnboardings)}/wk` : "—",
            note: `vault ~${data.rules.vaultTiktokOnboardingsPerWeek}/wk`,
          },
          { label: "Baseline non-Meta trials", value: b ? `${int(b.nonMetaTrials)}/wk` : "—", note: b ? `TikTok ${int(b.tiktokTrials)}/wk` : "" },
          {
            label: "Last full week",
            value: lastComplete ? `${signed(lastComplete.extraNonMetaTrials)}` : "—",
            note: lastComplete ? `extra non-Meta trials, ${shortDate(lastComplete.week)}` : "",
          },
          { label: "Spend logged", value: usd(totalSpend), note: `tranche size ${usd(data.rules.trancheUsd, 0)}` },
          { label: "Stop rule", value: `${usd(data.rules.doubleAtOrBelow, 0)} / ${usd(data.rules.pauseAbove, 0)}`, note: "double at or below / pause above x2" },
        ]}
      />

      {b && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginTop: 16 }}>
          <Card pad="14px 16px 10px">
            <div style={{ font: "650 13px var(--font-ui)", marginBottom: 6 }}>TikTok-sourced onboardings per week</div>
            <TrendChart
              ariaLabel="TikTok-sourced onboardings per week"
              color="var(--cat-1)"
              format={(v) => int(v)}
              points={data.weeks.map((w) => ({ x: w.week, y: w.complete ? w.tiktokOnboardings : null, note: `${int(w.onboardings)} onboardings in all` }))}
              refs={[
                { y: b.tiktokOnboardings, label: `baseline ${int(b.tiktokOnboardings)}` },
                { y: data.rules.vaultTiktokOnboardingsPerWeek, label: `vault ${data.rules.vaultTiktokOnboardingsPerWeek}`, dashed: true },
              ]}
            />
          </Card>
          <Card pad="14px 16px 10px">
            <div style={{ font: "650 13px var(--font-ui)", marginBottom: 6 }}>Non-Meta trials per week (TikTok + spillover)</div>
            <TrendChart
              ariaLabel="Non-Meta trials per week"
              color="var(--cat-2)"
              format={(v) => int(v)}
              points={data.weeks.map((w) => ({ x: w.week, y: w.complete ? w.nonMetaTrials : null, note: `${int(w.tiktokTrials)} said TikTok` }))}
              refs={[{ y: b.nonMetaTrials, label: `baseline ${int(b.nonMetaTrials)}` }]}
            />
          </Card>
        </div>
      )}

      <SectionHeader
        family="info"
        icon="Scissors"
        title="Weekly"
        meta={b ? `baseline ${shortDate(b.from)} to ${shortDate(b.to)} (${b.weeks} full weeks before the first spend)` : "no complete weeks yet"}
        right={
          <Button
            size="sm"
            variant="secondary"
            icon={<Icons.Plus />}
            disabled={!data.entriesReady || !lastComplete}
            title={data.entriesReady ? undefined : "Apply migration 0095 first"}
            onClick={() => lastComplete && setDraft(draftFor(data.weeks.find((w) => w.week === lastComplete.week)!))}
          >
            Log a week
          </Button>
        }
      />
      {!data.entriesReady && (
        <InfoWell style={{ marginBottom: 12 }}>clipper_campaign_weeks does not exist yet (migration 0095 not applied), so spend can't be saved.</InfoWell>
      )}
      {draft && (
        <Card style={{ marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, alignItems: "end" }}>
            <label style={labelStyle}>
              Week of
              <select style={input} value={draft.weekStart} onChange={(e) => setDraft(draftFor(data.weeks.find((w) => w.week === e.target.value)!))}>
                {weeks.map((w) => (
                  <option key={w.week} value={w.week}>
                    {shortDate(w.week)} to {shortDate(addDays(w.week, 6))}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Views bought
              <input style={input} inputMode="numeric" value={draft.viewsBought} onChange={(e) => setDraft({ ...draft, viewsBought: e.target.value })} placeholder="1100000" />
            </label>
            <label style={labelStyle}>
              Payouts ($)
              <input style={input} inputMode="decimal" value={draft.payoutsUsd} onChange={(e) => setDraft({ ...draft, payoutsUsd: e.target.value })} placeholder="1430" />
            </label>
            <label style={labelStyle}>
              Fees ($)
              <input style={input} inputMode="decimal" value={draft.feesUsd} onChange={(e) => setDraft({ ...draft, feesUsd: e.target.value })} placeholder="470" />
            </label>
            <label style={labelStyle}>
              Tranche
              <input style={input} value={draft.tranche} onChange={(e) => setDraft({ ...draft, tranche: e.target.value })} placeholder="T1 $3k" />
            </label>
          </div>
          <label style={{ ...labelStyle, marginTop: 12 }}>
            Note
            <input style={input} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Whop board, Reachify invoice #…" />
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save week"}
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </Button>
            {data.weeks.find((w) => w.week === draft.weekStart)?.entry && (
              <Button variant="danger" onClick={remove} disabled={saving} style={{ marginLeft: "auto" }}>
                Delete entry
              </Button>
            )}
          </div>
        </Card>
      )}
      <Card pad={0} style={tableCard}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {[
                "Week of",
                "Spend",
                "Views",
                "$ / 1k views",
                "TikTok onboardings",
                "TikTok trials",
                "Non-Meta trials",
                "Meta trials",
                "$ / extra trial",
                "TikTok-only",
                "Rule",
                "",
              ].map((h, i) => (
                <th key={h || i} style={thStyle(i === 0 || i >= 10 ? "left" : "right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.week} style={{ opacity: w.complete ? 1 : 0.6 }}>
                <td style={tdStyle("left")}>
                  {shortDate(w.week)}
                  {w.complete ? "" : " (in progress)"}
                </td>
                <td style={tdStyle()}>{w.spend > 0 ? usd(w.spend) : "—"}</td>
                <td style={tdStyle()}>{w.entry?.viewsBought != null ? int(w.entry.viewsBought) : "—"}</td>
                <td style={tdStyle()}>{usd(w.costPer1kViews)}</td>
                <td style={tdStyle()}>
                  {int(w.tiktokOnboardings)} <Delta v={w.complete ? w.extraTiktokOnboardings : null} />
                </td>
                <td style={tdStyle()}>
                  {int(w.tiktokTrials)} <Delta v={w.complete ? w.extraTiktokTrials : null} />
                </td>
                <td style={tdStyle()}>
                  {int(w.nonMetaTrials)} <Delta v={w.complete ? w.extraNonMetaTrials : null} />
                </td>
                <td style={tdStyle()}>{int(w.metaTrials)}</td>
                <td style={{ ...tdStyle(), fontWeight: 600 }}>{usd(w.costPerExtraTrial)}</td>
                <td style={tdStyle()}>{usd(w.costPerExtraTiktokTrial)}</td>
                <td style={tdStyle("left")}>{w.spend > 0 ? <StatusPill kind={STATUS[w.status].kind}>{STATUS[w.status].label}</StatusPill> : null}</td>
                <td style={tdStyle("left")}>
                  {data.entriesReady && (
                    <Button size="sm" variant="ghost" onClick={() => setDraft(draftFor(w))}>
                      {w.entry ? "Edit" : "Log"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <SectionHeader family="neutral" icon="Link" title="Per-creator codes" meta="from the Clippers tab: code in bio, /clip/<slug> dashboard" />
      {data.creators.length ? (
        <Card pad={0} style={tableCard}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Creator", "Code", "Dashboard link", "Trials with code", "Status"].map((h, i) => (
                  <th key={h} style={thStyle(i === 3 ? "right" : "left")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.creators.map((c) => (
                <tr key={c.id}>
                  <td style={tdStyle("left")}>{c.name}</td>
                  <td style={tdStyle("left")}>{c.code}</td>
                  <td style={tdStyle("left")}>
                    <a href={`/clip/${c.slug}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent-text)" }}>
                      /clip/{c.slug}
                    </a>
                  </td>
                  <td style={tdStyle()}>{int(c.trials)}</td>
                  <td style={tdStyle("left")}>{c.active ? "active" : "inactive"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <InfoWell>
          No creator codes yet. Add a clipper on the Clippers tab to give them a code and a /clip dashboard; trials carrying the code show here, and a
          per-creator spend row (clipper_campaign_weeks.clipper_id) can sit next to the campaign row.
        </InfoWell>
      )}

      <div style={{ height: 16 }} />
      <InfoWell>
        Rule (vault, lever 1): pause if an extra trial costs more than {usd(data.rules.pauseAbove, 0)} two weeks running; double the tranche at{" "}
        {usd(data.rules.doubleAtOrBelow, 0)} or less. Extra trials are non-Meta trials above the baseline, because clipper viewers also answer "App
        Store" or "friend/family"; the TikTok-only column is the strict upper bound on cost. A week with spend and no lift counts as over. January
        lifts every organic source, so read the Meta trials column as the check before calling a win.{" "}
        {one(b?.metaTrials)} Meta trials/wk in the baseline.
      </InfoWell>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
  font: "600 11px var(--font-ui)",
  color: "var(--ink-3)",
  letterSpacing: "0.03em",
};

function Delta({ v }: { v: number | null }) {
  if (v == null) return null;
  const r = Math.round(v);
  return (
    <span style={{ font: "500 11.5px var(--font-ui)", color: r > 0 ? "var(--success-text)" : r < 0 ? "var(--danger-text)" : "var(--ink-4)" }}>
      ({r > 0 ? "+" : r < 0 ? "−" : "±"}
      {Math.abs(r)})
    </span>
  );
}
