"use client";

/**
 * Growth AI · Overview — "this week at a glance" (Motion home equivalent):
 * KPI cards with week-over-week deltas, spend-vs-trials chart, performance
 * shifts (scaling / declining / new / paused), and the top spending creative
 * with AI thought-starters that jump into the analyst chat.
 */

import * as React from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import {
  type GrowthData,
  type AdAgg,
  type ShiftKind,
  classifyShifts,
  sliceWindows,
  daysAgoISO,
  num,
  safeDiv,
} from "./data";
import {
  fmtUSD,
  fmtInt,
  fmtPct,
  fmtX,
  KpiCard,
  SectionLabel,
  DeltaChip,
  StatusDot,
  Thumb,
  ErrorBanner,
} from "./shared";

function pctDelta(cur: number, prev: number): number | null {
  return prev > 0 ? ((cur - prev) / prev) * 100 : null;
}

export function GrowthOverview({
  data,
  onAsk,
  onOpenAd,
}: {
  data: GrowthData;
  onAsk: (prompt: string) => void;
  onOpenAd: (adId: string) => void;
}) {
  const isMobile = useIsMobile();
  const { rows, rcRows, blended, firstSeen, alerts, payback, error } = data;

  const weekly = React.useMemo(() => {
    const { cur, prev } = sliceWindows(rows, 7);
    const sum = (m: Map<string, AdAgg>, k: "spend" | "trial_starts" | "installs") =>
      [...m.values()].reduce((s, a) => s + a[k], 0);
    const since = daysAgoISO(6);
    const rcCur = rcRows.filter((x) => x.date >= since);
    const rcPrev = rcRows.filter((x) => x.date >= daysAgoISO(13) && x.date < since);
    const spend = sum(cur, "spend");
    const prevSpend = sum(prev, "spend");
    const metaTrials = sum(cur, "trial_starts");
    const prevMetaTrials = sum(prev, "trial_starts");
    const rcTrials = rcCur.reduce((s, x) => s + num(x.trial_starts), 0);
    const prevRcTrials = rcPrev.reduce((s, x) => s + num(x.trial_starts), 0);
    // "Launched" = truly first seen this week across the full 56d history,
    // not first seen within the window slice (which is every ad).
    const launched = [...cur.values()].filter(
      (a) => (firstSeen.get(a.ad_id) ?? a.first_seen) >= since,
    ).length;
    return {
      spend,
      spendDelta: pctDelta(spend, prevSpend),
      cpt: safeDiv(spend, metaTrials),
      cptDelta: pctDelta(safeDiv(spend, metaTrials), safeDiv(prevSpend, prevMetaTrials)),
      rcTrials,
      rcTrialsDelta: pctDelta(rcTrials, prevRcTrials),
      blendedCac: safeDiv(spend, rcTrials),
      launched,
      activeAds: [...cur.values()].filter((a) => a.effective_status === "ACTIVE").length,
    };
  }, [rows, rcRows, firstSeen]);

  const mer7 = blended.length > 0 ? num(blended[0].mer_7d) : NaN;

  const shifts = React.useMemo(() => classifyShifts(rows), [rows]);
  const [shiftTab, setShiftTab] = React.useState<ShiftKind>("scaling");
  const shiftOrder: Array<{ id: ShiftKind; label: string }> = [
    { id: "scaling", label: "Scaling" },
    { id: "declining", label: "Declining" },
    { id: "fatiguing", label: "Fatiguing" },
    { id: "new", label: "Newly launched" },
    { id: "paused", label: "Recently paused" },
  ];

  const topCreative = React.useMemo(() => {
    const { cur } = sliceWindows(rows, 7);
    const sorted = [...cur.values()].sort((a, b) => b.spend - a.spend);
    return sorted[0] ?? null;
  }, [rows]);

  const daily = React.useMemo(() => {
    const since = daysAgoISO(27);
    const byDate = new Map<string, { spend: number; trials: number }>();
    for (const x of rows) {
      if (x.date < since) continue;
      const d = byDate.get(x.date) ?? { spend: 0, trials: 0 };
      d.spend += num(x.spend);
      byDate.set(x.date, d);
    }
    for (const x of rcRows) {
      if (x.date < since) continue;
      const d = byDate.get(x.date) ?? { spend: 0, trials: 0 };
      d.trials = num(x.trial_starts);
      byDate.set(x.date, d);
    }
    return [...byDate.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [rows, rcRows]);

  return (
    <div>
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {alerts.length > 0 && <AlertsStrip alerts={alerts} onAsk={onAsk} />}

      {/* ---- KPI glance ---- */}
      <SectionLabel
        right={
          <span style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--font-geist-mono), monospace" }}>
            last 7 days vs prior 7
          </span>
        }
      >
        This week at a glance
      </SectionLabel>
      <div
        style={
          isMobile
            ? {
                display: "flex",
                gap: 12,
                overflowX: "auto",
                scrollSnapType: "x mandatory",
                margin: "0 -16px 24px",
                padding: "0 16px 6px",
              }
            : {
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 14,
                marginBottom: 28,
              }
        }
      >
        <KpiCard hero label="Total spend" value={fmtUSD(weekly.spend)} delta={weekly.spendDelta} goodWhen="up" />
        <KpiCard
          label="Cost / trial · Meta"
          value={fmtUSD(weekly.cpt)}
          delta={weekly.cptDelta}
          goodWhen="down"
          sub="spend ÷ Meta-reported trials"
        />
        <KpiCard
          label="Trials · RC truth"
          value={fmtInt(weekly.rcTrials)}
          delta={weekly.rcTrialsDelta}
          goodWhen="up"
          sub="all sources incl. organic"
        />
        <KpiCard
          label="Blended CAC / trial"
          value={fmtUSD(weekly.blendedCac)}
          sub="spend ÷ RC trials"
        />
        <KpiCard label="MER · 7d" value={fmtX(mer7)} sub="RC revenue ÷ Meta spend" />
        <KpiCard
          label="Creatives launched"
          value={fmtInt(weekly.launched)}
          sub={`${weekly.activeAds} ads live`}
        />
        {payback && payback.ltv30_to_cac != null && (
          <KpiCard
            label="LTV : CAC · 35d"
            value={fmtX(num(payback.ltv30_to_cac))}
            sub={payback.payback_verdict ?? "30d LTV ÷ blended CAC/sub"}
          />
        )}
      </div>

      {/* ---- spend vs trials chart ---- */}
      <SectionLabel
        right={
          <span style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--ink-3)" }}>
            <LegendSwatch color="color-mix(in oklab, var(--ink) 80%, transparent)" label="Meta spend" square />
            <LegendSwatch color="var(--accent)" label="RC trials" />
          </span>
        }
      >
        Spend vs trials · last 28 days
      </SectionLabel>
      <div
        style={{
          border: "1px solid var(--line)",
          borderRadius: 14,
          background: "var(--surface)",
          boxShadow: "var(--shadow-sm)",
          padding: isMobile ? "14px 10px 8px" : "20px 20px 12px",
          marginBottom: 28,
        }}
      >
        <SpendTrialsChart daily={daily} />
      </div>

      {/* ---- performance shifts ---- */}
      <SectionLabel>Performance shifts · week over week</SectionLabel>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {shiftOrder.map(({ id, label }) => {
          const count = shifts[id].length;
          const active = shiftTab === id;
          return (
            <button
              key={id}
              onClick={() => setShiftTab(id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "7px 14px",
                fontSize: 13,
                fontWeight: 500,
                borderRadius: 999,
                border: "1px solid",
                borderColor: active ? "var(--ink)" : "var(--line)",
                background: active ? "var(--ink)" : "var(--surface)",
                color: active ? "var(--surface)" : "var(--ink-2)",
                cursor: "pointer",
              }}
            >
              {label}
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-geist-mono), monospace",
                  opacity: 0.7,
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
      {shifts[shiftTab].length === 0 ? (
        <div
          style={{
            padding: "22px 24px",
            borderRadius: 14,
            border: "1px dashed var(--line)",
            background: "var(--surface)",
            color: "var(--ink-3)",
            fontSize: 13,
            marginBottom: 28,
          }}
        >
          <span className="serif" style={{ fontStyle: "italic", fontSize: 16, marginRight: 8 }}>
            Nothing here this week.
          </span>
          No ads match this shift right now.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 150 : 190}px, 1fr))`,
            gap: 14,
            marginBottom: 28,
          }}
        >
          {shifts[shiftTab].slice(0, 8).map(({ agg, deltaPct, note }) => (
            <ShiftCard
              key={agg.ad_id}
              agg={agg}
              deltaPct={deltaPct}
              note={note}
              onAsk={onAsk}
              onOpenAd={onOpenAd}
            />
          ))}
        </div>
      )}

      {/* ---- top spending creative + thought starters ---- */}
      {topCreative && (
        <>
          <SectionLabel>This week&rsquo;s top spending creative</SectionLabel>
          <TopCreativeCard agg={topCreative} onAsk={onAsk} onOpenAd={onOpenAd} isMobile={isMobile} />
        </>
      )}
    </div>
  );
}

function AlertsStrip({
  alerts,
  onAsk,
}: {
  alerts: GrowthData["alerts"];
  onAsk: (prompt: string) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const visible = expanded ? alerts : alerts.slice(0, 4);
  const toneOf = (sev: string) =>
    sev === "critical" ? "var(--accent)" : sev === "warn" ? "var(--p-sarah)" : "var(--ink-4)";
  return (
    <div style={{ marginBottom: 22 }}>
      <SectionLabel
        right={
          alerts.length > 4 ? (
            <button
              onClick={() => setExpanded((v) => !v)}
              style={{
                fontSize: 11,
                border: "none",
                background: "transparent",
                color: "var(--ink-3)",
                cursor: "pointer",
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              {expanded ? "collapse" : `show all ${alerts.length}`}
            </button>
          ) : undefined
        }
      >
        Alerts · last 7 days
      </SectionLabel>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {visible.map((a) => {
          const tone = toneOf(a.severity);
          return (
            <button
              key={a.id}
              onClick={() =>
                onAsk(
                  `Investigate this alert from ${a.alert_date}: "${a.message}". What caused it and what should we do?`,
                )
              }
              title="Ask the AI analyst to investigate"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 12px",
                fontSize: 12,
                borderRadius: 999,
                border: `1px solid color-mix(in oklab, ${tone} 35%, var(--line))`,
                background: `color-mix(in oklab, ${tone} 10%, var(--surface))`,
                color: "var(--ink-2)",
                cursor: "pointer",
                maxWidth: 480,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: tone,
                  flexShrink: 0,
                }}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.message}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LegendSwatch({ color, label, square }: { color: string; label: string; square?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: square ? 10 : 14,
          height: square ? 10 : 3,
          borderRadius: square ? 3 : 2,
          background: color,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}

function SpendTrialsChart({ daily }: { daily: Array<{ date: string; spend: number; trials: number }> }) {
  const W = 720;
  const H = 200;
  const padL = 40;
  const padR = 4;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padB;
  const [hover, setHover] = React.useState<number | null>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);

  if (daily.length === 0) {
    return (
      <div style={{ padding: 30, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
        No daily data yet — run /api/cron/sync-ad-insights.
      </div>
    );
  }

  const maxSpend = Math.max(...daily.map((d) => d.spend), 1);
  const maxTrials = Math.max(...daily.map((d) => d.trials), 1);
  const n = daily.length;
  const slot = innerW / n;
  const barW = Math.max(4, slot * 0.55);

  const trialPoints = daily
    .map((d, i) => {
      const x = padL + i * slot + slot / 2;
      const y = innerH - (d.trials / maxTrials) * (innerH - 10);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.min(n - 1, Math.max(0, Math.floor((x - padL) / slot)));
    setHover(idx);
  };
  const hovered = hover != null ? daily[hover] : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label="Daily Meta spend (bars) vs RevenueCat trials (line)"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      {/* gridlines + y-axis spend labels */}
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line
            x1={padL}
            x2={W - padR}
            y1={innerH - f * (innerH - 10)}
            y2={innerH - f * (innerH - 10)}
            stroke="var(--line)"
            strokeWidth={1}
            strokeDasharray={f === 0 ? undefined : "3 5"}
          />
          <text
            x={padL - 6}
            y={innerH - f * (innerH - 10) + 3}
            textAnchor="end"
            style={{ fontSize: 9, fontFamily: "var(--font-geist-mono), monospace", fill: "var(--ink-4)" }}
          >
            ${Math.round(maxSpend * f)}
          </text>
        </g>
      ))}
      {/* spend bars */}
      {daily.map((d, i) => {
        const h = (d.spend / maxSpend) * (innerH - 10);
        const x = padL + i * slot + (slot - barW) / 2;
        return (
          <rect
            key={d.date}
            x={x}
            y={innerH - h}
            width={barW}
            height={Math.max(h, d.spend > 0 ? 2 : 0)}
            rx={2}
            fill="color-mix(in oklab, var(--ink) 80%, transparent)"
            opacity={0.85}
          >
            <title>{`${d.date} · ${fmtUSD(d.spend)} spend · ${d.trials} trials`}</title>
          </rect>
        );
      })}
      {/* trials line */}
      <polyline
        points={trialPoints}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {daily.map((d, i) => {
        const x = padL + i * slot + slot / 2;
        const y = innerH - (d.trials / maxTrials) * (innerH - 10);
        return (
          <circle key={`c-${d.date}`} cx={x} cy={y} r={2.4} fill="var(--accent)">
            <title>{`${d.date} · ${d.trials} trials`}</title>
          </circle>
        );
      })}
      {/* x labels: every 7th day */}
      {daily.map((d, i) =>
        i % 7 === 0 || i === n - 1 ? (
          <text
            key={`t-${d.date}`}
            x={padL + i * slot + slot / 2}
            y={H - 6}
            textAnchor="middle"
            style={{
              fontSize: 10,
              fontFamily: "var(--font-geist-mono), monospace",
              fill: "var(--ink-4)",
            }}
          >
            {d.date.slice(5)}
          </text>
        ) : null,
      )}
      {/* hover: vertical rule + tooltip */}
      {hovered && hover != null && (
        <g pointerEvents="none">
          <line
            x1={padL + hover * slot + slot / 2}
            x2={padL + hover * slot + slot / 2}
            y1={4}
            y2={innerH}
            stroke="var(--ink-3)"
            strokeWidth={1}
            strokeDasharray="2 3"
          />
          {(() => {
            const boxW = 148;
            const rawX = padL + hover * slot + slot / 2 + 8;
            const x = rawX + boxW > W - padR ? rawX - boxW - 16 : rawX;
            return (
              <g>
                <rect x={x} y={8} width={boxW} height={52} rx={8} fill="var(--ink)" opacity={0.92} />
                <text x={x + 10} y={24} style={{ fontSize: 10, fontFamily: "var(--font-geist-mono), monospace", fill: "var(--surface)", opacity: 0.7 }}>
                  {hovered.date}
                </text>
                <text x={x + 10} y={40} style={{ fontSize: 12, fontWeight: 600, fill: "var(--surface)" }}>
                  {fmtUSD(hovered.spend)} spend
                </text>
                <text x={x + 10} y={54} style={{ fontSize: 11, fill: "var(--surface)", opacity: 0.85 }}>
                  {hovered.trials} RC trials
                </text>
              </g>
            );
          })()}
        </g>
      )}
    </svg>
  );
}

function ShiftCard({
  agg,
  deltaPct,
  note,
  onAsk,
  onOpenAd,
}: {
  agg: AdAgg;
  deltaPct: number | null;
  note?: string;
  onAsk: (prompt: string) => void;
  onOpenAd: (adId: string) => void;
}) {
  const cpt = safeDiv(agg.spend, agg.trial_starts);
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 14,
        background: "var(--surface)",
        boxShadow: "var(--shadow-sm)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        onClick={() => onOpenAd(agg.ad_id)}
        title="Open creative details"
        style={{ position: "relative", aspectRatio: "5 / 4", background: "var(--surface-2)", cursor: "pointer" }}
      >
        {agg.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={agg.thumbnail}
            alt={agg.ad_name}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-4)",
              fontSize: 11,
            }}
          >
            no thumbnail
          </div>
        )}
        {deltaPct != null && (
          <div style={{ position: "absolute", top: 8, right: 8 }}>
            <DeltaChip pct={deltaPct} goodWhen="up" />
          </div>
        )}
      </div>
      <div style={{ padding: "10px 12px 12px", display: "grid", gap: 6 }}>
        <div
          title={agg.ad_name}
          style={{
            fontSize: 12.5,
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {agg.ad_name || agg.ad_id}
        </div>
        {note && (
          <div
            style={{
              fontSize: 10.5,
              color: "var(--accent)",
              fontFamily: "var(--font-geist-mono), monospace",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={note}
          >
            {note}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {fmtUSD(agg.spend)}
          </span>
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {Number.isFinite(cpt) ? `${fmtUSD(cpt)}/trial` : "no trials"}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <StatusDot status={agg.effective_status} />
          <button
            onClick={() =>
              onAsk(
                `Analyze the ad "${agg.ad_name}" (ad_id ${agg.ad_id}). Why is it trending the way it is week-over-week, and what should we do next?`,
              )
            }
            style={{
              fontSize: 11,
              padding: "3px 9px",
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "var(--surface-2)",
              color: "var(--ink-2)",
              cursor: "pointer",
            }}
          >
            ✦ Analyze
          </button>
        </div>
      </div>
    </div>
  );
}

function TopCreativeCard({
  agg,
  onAsk,
  onOpenAd,
  isMobile,
}: {
  agg: AdAgg;
  onAsk: (prompt: string) => void;
  onOpenAd: (adId: string) => void;
  isMobile: boolean;
}) {
  const cpt = safeDiv(agg.spend, agg.trial_starts);
  const hook = safeDiv(agg.v3, agg.impressions);
  const ctr = safeDiv(agg.clicks, agg.impressions);
  const starters = [
    `Analyze the ad "${agg.ad_name}" (ad_id ${agg.ad_id}) — what's driving its performance and where does it lose people?`,
    `Give me 5 new hook ideas based on what's working in "${agg.ad_name}".`,
    `Should we scale "${agg.ad_name}"? Compare it to the rest of the account and recommend a budget move.`,
  ];
  const starterLabels = ["Analyze this ad", "New hook ideas from this ad", "Should we scale it?"];

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: "var(--radius-lg)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-sm)",
        padding: isMobile ? 14 : 22,
        display: "flex",
        gap: isMobile ? 14 : 24,
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "stretch" : "flex-start",
      }}
    >
      <div onClick={() => onOpenAd(agg.ad_id)} style={{ cursor: "pointer" }} title="Open creative details">
        <Thumb src={agg.thumbnail} name={agg.ad_name} size={isMobile ? 120 : 168} radius={12} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div className="serif" style={{ fontSize: isMobile ? 19 : 23, letterSpacing: "-0.02em" }}>
            {agg.ad_name || agg.ad_id}
          </div>
          <StatusDot status={agg.effective_status} />
        </div>
        <p style={{ fontSize: 13.5, color: "var(--ink-3)", margin: "8px 0 14px", lineHeight: 1.55 }}>
          This ad drove <strong style={{ color: "var(--ink)" }}>{fmtUSD(agg.spend)}</strong> in spend over the
          last 7 days
          {Number.isFinite(cpt) ? (
            <>
              {" "}
              at <strong style={{ color: "var(--ink)" }}>{fmtUSD(cpt)}</strong> per trial started
            </>
          ) : (
            <> with no Meta-reported trials yet</>
          )}
          .
        </p>
        <div style={{ display: "flex", gap: isMobile ? 16 : 28, flexWrap: "wrap", marginBottom: 16 }}>
          <MiniStat label="Trials" value={fmtInt(agg.trial_starts)} />
          <MiniStat label="Installs" value={fmtInt(agg.installs)} />
          <MiniStat label="Hook rate" value={fmtPct(hook)} />
          <MiniStat label="CTR" value={fmtPct(ctr)} />
          <MiniStat label="Impressions" value={fmtInt(agg.impressions)} />
        </div>
        <div
          style={{
            fontSize: 10,
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--ink-4)",
            marginBottom: 8,
          }}
        >
          Thought starters · AI
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {starters.map((s, i) => (
            <button
              key={i}
              onClick={() => onAsk(s)}
              style={{
                padding: "7px 13px",
                fontSize: 12.5,
                borderRadius: 999,
                border: "1px solid var(--line-2)",
                background: "var(--surface-2)",
                color: "var(--ink-2)",
                cursor: "pointer",
              }}
            >
              ✦ {starterLabels[i]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--ink-3)",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}
