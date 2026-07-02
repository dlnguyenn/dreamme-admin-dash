"use client";

/**
 * Growth AI · Creative leaderboard — Motion's leaderboard equivalent:
 * rank every creative by the metric that matters, thumbnail-first, with
 * week-over-week spend deltas, weeks on board, and attention diagnostics.
 */

import * as React from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import {
  type GrowthData,
  type AdAgg,
  sliceWindows,
  safeDiv,
} from "./data";
import {
  fmtUSD,
  fmtInt,
  fmtPct,
  weeksSince,
  SectionLabel,
  DeltaChip,
  StatusDot,
  TagChip,
  Thumb,
  ErrorBanner,
  EmptyState,
  adsManagerAdUrl,
} from "./shared";

const RANGES = [7, 14, 30] as const;
type RangeDays = (typeof RANGES)[number];

const SORTS = [
  { id: "spend", label: "Spend" },
  { id: "cpt", label: "Cost / trial" },
  { id: "trials", label: "Trials" },
  { id: "hook", label: "Hook rate" },
] as const;
type SortId = (typeof SORTS)[number]["id"];

interface LeaderRow {
  agg: AdAgg;
  deltaPct: number | null;
  cpt: number;
  hook: number;
  hold: number;
  ctr: number;
  weeks: number;
}

export function GrowthLeaderboard({
  data,
  onAsk,
  onOpenAd,
}: {
  data: GrowthData;
  onAsk: (prompt: string) => void;
  onOpenAd: (adId: string) => void;
}) {
  const isMobile = useIsMobile();
  const [range, setRange] = React.useState<RangeDays>(7);
  const [statusFilter, setStatusFilter] = React.useState<"all" | "ACTIVE" | "PAUSED">("all");
  const [sortBy, setSortBy] = React.useState<SortId>("spend");

  const leaders = React.useMemo<LeaderRow[]>(() => {
    const { cur, prev } = sliceWindows(data.rows, range);
    let out = [...cur.values()].map((agg) => {
      const p = prev.get(agg.ad_id);
      const first = data.firstSeen.get(agg.ad_id) ?? agg.first_seen;
      return {
        agg,
        deltaPct: p && p.spend > 0 ? ((agg.spend - p.spend) / p.spend) * 100 : null,
        cpt: safeDiv(agg.spend, agg.trial_starts),
        hook: safeDiv(agg.v3, agg.impressions),
        hold: safeDiv(agg.thru, agg.impressions),
        ctr: safeDiv(agg.clicks, agg.impressions),
        weeks: weeksSince(first),
      };
    });
    if (statusFilter !== "all") {
      out = out.filter((x) => x.agg.effective_status === statusFilter);
    }
    const val = (x: LeaderRow): number => {
      if (sortBy === "spend") return x.agg.spend;
      if (sortBy === "trials") return x.agg.trial_starts;
      if (sortBy === "hook") return Number.isFinite(x.hook) ? x.hook : -1;
      // cpt: ascending (cheaper is better), only rank ads with trials
      return Number.isFinite(x.cpt) ? -x.cpt : -Infinity;
    };
    return out.sort((a, b) => val(b) - val(a));
  }, [data.rows, data.firstSeen, range, statusFilter, sortBy]);

  const totalSpend = leaders.reduce((s, x) => s + x.agg.spend, 0);

  return (
    <div>
      {data.error && <ErrorBanner>{data.error}</ErrorBanner>}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <PillGroup
          options={RANGES.map((d) => ({ id: String(d), label: `${d}d` }))}
          value={String(range)}
          onChange={(v) => setRange(Number(v) as RangeDays)}
        />
        <PillGroup
          options={[
            { id: "all", label: "All" },
            { id: "ACTIVE", label: "Live" },
            { id: "PAUSED", label: "Paused" },
          ]}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as "all" | "ACTIVE" | "PAUSED")}
        />
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span
            style={{
              fontSize: 11,
              fontFamily: "var(--font-geist-mono), monospace",
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              color: "var(--ink-3)",
            }}
          >
            Rank by
          </span>
          <PillGroup
            options={SORTS.map((s) => ({ id: s.id, label: s.label }))}
            value={sortBy}
            onChange={(v) => setSortBy(v as SortId)}
          />
        </div>
      </div>

      <SectionLabel
        right={
          <span style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--font-geist-mono), monospace" }}>
            {leaders.length} creatives · {fmtUSD(totalSpend)} spend
          </span>
        }
      >
        Creative leaderboard · last {range} days
      </SectionLabel>

      {leaders.length === 0 ? (
        <EmptyState title="No creatives in this window.">
          Adjust the filters, or run /api/cron/sync-ad-insights to backfill.
        </EmptyState>
      ) : (
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 14,
            overflowX: "auto",
            background: "var(--surface)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: isMobile ? 720 : 0 }}>
            <thead>
              <tr>
                {["#", "Creative", "Status", "Wks", "Spend", "Trials", "Cost / trial", "Hook", "Hold", "CTR", ""].map(
                  (h, i) => (
                    <th
                      key={`${h}-${i}`}
                      style={{
                        textAlign: i <= 1 ? "left" : i >= 10 ? "center" : "right",
                        padding: "11px 14px",
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
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {leaders.map((row, i) => (
                <LeaderTr
                  key={row.agg.ad_id}
                  row={row}
                  rank={i + 1}
                  theme={data.tags.get(row.agg.ad_id)?.messaging_theme ?? null}
                  onAsk={onAsk}
                  onOpenAd={onOpenAd}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: 16, fontSize: 11.5, color: "var(--ink-4)", fontStyle: "italic", lineHeight: 1.6 }}>
        Trials and cost/trial are Meta-reported (ranking signal, not absolute truth — ATT under-counting).
        Hook = 3-sec video views ÷ impressions · Hold = thruplays ÷ impressions. Spend delta compares the
        prior {range}-day window.
      </p>
    </div>
  );
}

function LeaderTr({
  row,
  rank,
  theme,
  onAsk,
  onOpenAd,
}: {
  row: LeaderRow;
  rank: number;
  theme: string | null;
  onAsk: (p: string) => void;
  onOpenAd: (adId: string) => void;
}) {
  const { agg } = row;
  const adsManager = adsManagerAdUrl(agg.ad_id);
  const td = (align: "left" | "right" | "center" = "right"): React.CSSProperties => ({
    textAlign: align,
    padding: "9px 14px",
    borderBottom: "1px solid var(--line)",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  });
  return (
    <tr
      onClick={() => onOpenAd(agg.ad_id)}
      title="Open creative details"
      style={{ cursor: "pointer", transition: "background 120ms ease" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <td style={{ ...td("left"), width: 34 }}>
        <span
          className="serif"
          style={{ fontSize: 17, color: rank <= 3 ? "var(--ink)" : "var(--ink-3)" }}
        >
          {rank}
        </span>
      </td>
      <td style={{ ...td("left"), whiteSpace: "normal", minWidth: 220 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Thumb src={agg.thumbnail} name={agg.ad_name} size={40} radius={7} />
          <div style={{ minWidth: 0 }}>
            <div
              title={agg.ad_name}
              style={{
                fontSize: 13,
                fontWeight: 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 260,
              }}
            >
              {agg.ad_name || agg.ad_id}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 1,
                minWidth: 0,
              }}
            >
              <span
                title={agg.campaign_name}
                style={{
                  fontSize: 11,
                  color: "var(--ink-4)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: theme ? 140 : 260,
                }}
              >
                {agg.campaign_name}
              </span>
              {theme && <TagChip kind="theme">{theme}</TagChip>}
            </div>
          </div>
        </div>
      </td>
      <td style={td("right")}>
        <StatusDot status={agg.effective_status} />
      </td>
      <td style={{ ...td(), color: "var(--ink-3)" }}>{row.weeks}</td>
      <td style={td()}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{fmtUSD(agg.spend)}</span>
          <DeltaChip pct={row.deltaPct} goodWhen="up" />
        </div>
      </td>
      <td style={td()}>{fmtInt(agg.trial_starts)}</td>
      <td style={td()}>
        {Number.isFinite(row.cpt) ? (
          <span style={{ fontWeight: 500 }}>{fmtUSD(row.cpt)}</span>
        ) : (
          <span style={{ color: "var(--ink-4)" }}>—</span>
        )}
      </td>
      <td style={{ ...td(), color: hookTone(row.hook) }}>{fmtPct(row.hook)}</td>
      <td style={td()}>{fmtPct(row.hold)}</td>
      <td style={td()}>{fmtPct(row.ctr)}</td>
      <td style={{ ...td("center") }}>
        <div style={{ display: "inline-flex", gap: 6 }}>
          <button
            title="Ask the AI analyst about this ad"
            onClick={(e) => {
              e.stopPropagation();
              onAsk(
                `Analyze the ad "${agg.ad_name}" (ad_id ${agg.ad_id}) over the last 14 days — performance vs the account, where it loses people (hook/hold/click), and what to do next.`,
              );
            }}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "var(--surface-2)",
              color: "var(--ink-2)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ✦ Analyze
          </button>
          <a
            title="Open in Meta Ads Manager"
            href={adsManager}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              color: "var(--ink-3)",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            ↗
          </a>
        </div>
      </td>
    </tr>
  );
}

function hookTone(hook: number): string {
  if (!Number.isFinite(hook)) return "var(--ink-4)";
  if (hook >= 0.3) return "var(--accent-2)";
  if (hook >= 0.2) return "var(--ink-2)";
  return "var(--accent)";
}

function PillGroup({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            style={{
              padding: "6px 13px",
              fontSize: 12.5,
              fontWeight: 500,
              borderRadius: 999,
              border: "1px solid",
              borderColor: active ? "var(--ink)" : "var(--line)",
              background: active ? "var(--ink)" : "var(--surface)",
              color: active ? "var(--surface)" : "var(--ink-2)",
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
