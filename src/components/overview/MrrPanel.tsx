"use client";

/**
 * MRR growth: where MRR is, how much it moved yesterday / this week / this
 * month, and whether the growth rate itself is rising or falling.
 *
 * Two charts, each one series on one axis:
 *  - daily MRR change (bars around a zero line) with its 7-day average;
 *  - the rolling 30-day growth rate, which is the "is growth slowing?" view.
 *
 * Every change is between complete days. The newest row is a ~3am ET
 * snapshot, so it only feeds the headline number (see lib/overview-mrr.ts).
 */

import * as React from "react";
import { useIsMobile } from "@/lib/useIsMobile";
import type { MrrDay, MrrGrowthPoint, MrrSection } from "@/lib/overview-mrr";
import { Card, InfoWell, SectionHeader, StatStrip, fam, type Family } from "../porcelain";
import { EmptyState, fmtMoney, fmtNum, shortDay } from "./shared";

const signedMoney = (n: number | null | undefined, dp = 0) =>
  n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "−" : "+"}${fmtMoney(Math.abs(n), dp)}`;
const signedPct = (n: number | null | undefined, dp = 1) =>
  n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(dp)}%`;
const signedNum = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${n < 0 ? "−" : "+"}${fmtNum(Math.abs(n))}`;
const upDown = (n: number | null | undefined): Family =>
  n == null ? "neutral" : n > 0 ? "success" : n < 0 ? "danger" : "neutral";

function fmtK(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : fmtMoney(n);
}

function longDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Width of a container, for charts drawn in real pixels (crisp 2px lines). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = React.useRef<T>(null);
  const [w, setW] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Trend sentence: compares this 30-day window's growth with the one before. */
function trendLine(m: MrrSection): { text: string; family: Family } | null {
  const d30 = m.d30;
  if (!d30) return null;
  const parts: string[] = [];
  let family: Family = "neutral";
  if (d30.priorPct != null) {
    const diff = d30.pct - d30.priorPct;
    const verb =
      Math.abs(diff) < 0.3 ? "holding steady" : diff < 0 ? "slowing" : "speeding up";
    family = Math.abs(diff) < 0.3 ? "neutral" : diff < 0 ? "warning" : "success";
    parts.push(
      `Growth is ${verb}: MRR grew ${signedPct(d30.pct)} over the last 30 days, ` +
        `vs ${signedPct(d30.priorPct)} in the 30 days before ` +
        `(${signedMoney(d30.perDay)}/day vs ${signedMoney((d30.priorChange ?? 0) / 30)}/day).`,
    );
  } else {
    parts.push(`MRR grew ${signedPct(d30.pct)} over the last 30 days (${signedMoney(d30.perDay)}/day).`);
  }
  if (m.d7) {
    parts.push(
      `This week ran at ${signedMoney(m.d7.perDay)}/day` +
        (m.d7.priorChange != null ? `, vs ${signedMoney(m.d7.priorChange / 7)}/day the week before.` : "."),
    );
  }
  if (m.milestone) {
    parts.push(
      `At the 30-day pace MRR reaches ${fmtK(m.milestone.target)} around ${longDay(m.milestone.date)} ` +
        `(${m.milestone.days} days).`,
    );
  } else if (d30.perDay <= 0) {
    family = "danger";
    parts.push("MRR is shrinking over the last 30 days.");
  }
  return { text: parts.join(" "), family };
}

export function MrrPanel({ mrr }: { mrr: MrrSection | null }) {
  const isMobile = useIsMobile();
  if (!mrr) {
    return (
      <>
        <SectionHeader family="success" icon="Trend" title="MRR growth" />
        <Card>
          <EmptyState title="Couldn't load MRR history">
            rc_account_metrics_daily didn&rsquo;t answer. Try Refresh.
          </EmptyState>
        </Card>
      </>
    );
  }

  const trend = trendLine(mrr);
  const syncedLabel = mrr.syncedAt
    ? new Date(mrr.syncedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      })
    : null;

  return (
    <>
      <SectionHeader
        family="success"
        icon="Trend"
        title="MRR growth"
        meta={`RevenueCat · synced daily${syncedLabel ? ` at ${syncedLabel} ET` : ""}`}
      />
      <Card pad={isMobile ? "14px 12px 16px" : "18px 20px 18px"}>
        <StatStrip
          minColWidth={isMobile ? 140 : 150}
          stats={[
            {
              label: "MRR",
              value: fmtMoney(mrr.mrr),
              note: `ARR ${fmtK(mrr.arr)}`,
            },
            {
              label: mrr.lastDay ? `Yesterday · ${shortDay(mrr.lastDay.date)}` : "Yesterday",
              value: signedMoney(mrr.lastDay?.change),
              delta: mrr.lastDay ? signedPct(mrr.lastDay.pct, 2) : undefined,
              deltaFamily: upDown(mrr.lastDay?.change),
              note:
                mrr.todaySoFar != null ? `today ${signedMoney(mrr.todaySoFar)}` : undefined,
            },
            {
              label: "Last 7 days",
              value: signedMoney(mrr.d7?.change),
              delta: mrr.d7 ? signedPct(mrr.d7.pct) : undefined,
              deltaFamily: upDown(mrr.d7?.change),
              note: mrr.d7?.priorPct != null ? `prev ${signedPct(mrr.d7.priorPct)}` : undefined,
            },
            {
              label: "Last 30 days",
              value: signedMoney(mrr.d30?.change),
              delta: mrr.d30 ? signedPct(mrr.d30.pct) : undefined,
              deltaFamily: upDown(mrr.d30?.change),
              note: mrr.d30?.priorPct != null ? `prev ${signedPct(mrr.d30.priorPct)}` : undefined,
            },
            {
              label: "MRR per sub",
              value: fmtMoney(mrr.perSub, 2),
              note: mrr.perSub30dAgo != null ? `${fmtMoney(mrr.perSub30dAgo, 2)} 30d ago` : undefined,
            },
            {
              label: "Net new subs · 7d",
              value: signedNum(mrr.netSubs7d),
              note: mrr.netSubs30d != null ? `${signedNum(mrr.netSubs30d)} in 30d` : undefined,
            },
          ]}
        />

        {trend && (
          <InfoWell
            style={{
              marginTop: 14,
              color: "var(--ink-2)",
            }}
          >
            {trend.text}
            {mrr.upDays30 != null && ` MRR rose on ${mrr.upDays30} of the last 30 days.`}
          </InfoWell>
        )}

        <div
          style={{
            display: "grid",
            // minmax(0, …): the charts must not hold their column open past the window.
            gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "minmax(0, 1.25fr) minmax(0, 1fr)",
            gap: isMobile ? 22 : 28,
            marginTop: 18,
          }}
        >
          <DailyChangeChart daily={mrr.daily} />
          <GrowthRateChart growth={mrr.growth} />
        </div>

        <div style={{ marginTop: 12, font: "400 11.5px/1.5 var(--font-ui)", color: "var(--ink-4)" }}>
          Changes are between complete days (UTC, as RevenueCat reports them). The newest number
          is a snapshot from the morning sync, so it can sit a little under the live RevenueCat
          figure. MRR counts yearly plans at a twelfth of their price.
        </div>
      </Card>
    </>
  );
}

// ---- Charts ---------------------------------------------------------------

const PLOT_H = 140;
const PAD_L = 44;

function ChartTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ font: "650 12.5px var(--font-ui)", color: "var(--ink)" }}>{title}</div>
      <div style={{ font: "400 11.5px var(--font-ui)", color: "var(--ink-4)", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function Tooltip({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: 30, marginBottom: 4 }}>
      {children && (
        <div
          style={{
            display: "inline-flex",
            flexWrap: "wrap",
            alignItems: "center",
            columnGap: 10,
            padding: "5px 10px",
            borderRadius: 10,
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
            font: "500 12px var(--font-ui)",
            fontVariantNumeric: "tabular-nums",
            color: "var(--ink-2)",
            whiteSpace: "nowrap",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function Ticks({ first, mid, last }: { first?: string; mid?: string; last?: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        marginTop: 6,
        paddingLeft: PAD_L,
        font: "400 11px var(--font-ui)",
        color: "var(--ink-4)",
      }}
    >
      <span>{first ? shortDay(first) : ""}</span>
      <span>{mid ? shortDay(mid) : ""}</span>
      <span>{last ? shortDay(last) : ""}</span>
    </div>
  );
}

function yLabelStyle(): React.CSSProperties {
  return { font: "400 10.5px var(--font-ui)", fill: "var(--ink-4)" } as React.CSSProperties;
}

function DailyChangeChart({ daily }: { daily: MrrDay[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const days = daily.filter((d) => d.change != null);
  const active = hover != null ? days[hover] : null;

  const vals = days.flatMap((d) => [d.change ?? 0, d.avg7 ?? 0]);
  const max = Math.max(0, ...vals);
  const min = Math.min(0, ...vals);
  const range = max - min || 1;
  const y = (v: number) => 4 + ((max - v) / range) * (PLOT_H - 8);
  const plotW = Math.max(0, width - PAD_L);
  const step = days.length ? plotW / days.length : 0;
  const barW = Math.max(1, step - 2); // 2px surface gap between bars
  const x = (i: number) => PAD_L + i * step;

  const avgPts = days
    .map((d, i) => (d.avg7 == null ? null : `${(x(i) + step / 2).toFixed(1)},${y(d.avg7).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      <ChartTitle title="Daily MRR change" sub={`Last ${days.length} days · bars = day's change, line = 7-day average`} />
      <Tooltip>
        {active && (
          <>
            <span style={{ color: "var(--ink)", fontWeight: 650 }}>{longDay(active.date)}</span>
            <span style={{ color: "var(--ink)", fontWeight: 650 }}>{signedMoney(active.change)}</span>
            <span>7d avg {signedMoney(active.avg7)}</span>
            <span>MRR {fmtMoney(active.mrr)}</span>
          </>
        )}
      </Tooltip>
      <div ref={ref} style={{ position: "relative", height: PLOT_H }} onMouseLeave={() => setHover(null)}>
        {width > 0 && days.length > 0 && (
          <svg width={width} height={PLOT_H} style={{ position: "absolute", inset: 0, display: "block", overflow: "visible" }}>
            {hover != null && (
              <rect x={x(hover)} y={0} width={step} height={PLOT_H} rx={4} fill="var(--surface-2)" />
            )}
            <line x1={PAD_L} x2={width} y1={y(0)} y2={y(0)} stroke="var(--chart-grid)" strokeWidth={1} />
            {max > 0 && (
              <>
                <line x1={PAD_L} x2={width} y1={y(max)} y2={y(max)} stroke="var(--chart-grid)" strokeDasharray="2 4" />
                <text x={PAD_L - 6} y={y(max) + 4} textAnchor="end" style={yLabelStyle()}>
                  {signedMoney(max)}
                </text>
              </>
            )}
            <text x={PAD_L - 6} y={y(0) + 4} textAnchor="end" style={yLabelStyle()}>
              $0
            </text>
            {min < 0 && (
              <text x={PAD_L - 6} y={y(min) + 4} textAnchor="end" style={yLabelStyle()}>
                {signedMoney(min)}
              </text>
            )}
            {days.map((d, i) => {
              const v = d.change ?? 0;
              const top = v >= 0 ? y(v) : y(0);
              const h = Math.max(1.5, Math.abs(y(v) - y(0)));
              const r = Math.min(4, barW / 2, h);
              const isHover = hover === i;
              const bx = x(i) + 1;
              // Rounded data-end only: the top for gains, the bottom for losses.
              const path =
                v >= 0
                  ? `M${bx},${top + h} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${top + h} Z`
                  : `M${bx},${top} V${top + h - r} Q${bx},${top + h} ${bx + r},${top + h} H${bx + barW - r} Q${bx + barW},${top + h} ${bx + barW},${top + h - r} V${top} Z`;
              return (
                <path
                  key={d.date}
                  d={path}
                  fill={v >= 0 ? "var(--chart-bar)" : "var(--ink-4)"}
                  opacity={hover == null || isHover ? 1 : 0.45}
                />
              );
            })}
            {avgPts && (
              <polyline
                points={avgPts}
                fill="none"
                stroke="var(--chart-line)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {/* Whole-column hit targets, wider than the bars. */}
            {days.map((d, i) => (
              <rect
                key={`hit-${d.date}`}
                x={x(i)}
                y={0}
                width={step}
                height={PLOT_H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            ))}
          </svg>
        )}
      </div>
      <Ticks
        first={days[0]?.date}
        mid={days[Math.floor(days.length / 2)]?.date}
        last={days[days.length - 1]?.date}
      />
    </div>
  );
}

function GrowthRateChart({ growth }: { growth: MrrGrowthPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<number | null>(null);
  const active = hover != null ? growth[hover] : null;

  const vals = growth.map((g) => g.pct30);
  const rawMax = Math.max(...vals, 0);
  const rawMin = Math.min(...vals, 0);
  // Pad the range so the line never touches the top edge.
  const max = rawMax + (rawMax - rawMin) * 0.08;
  const min = rawMin;
  const range = max - min || 1;
  const y = (v: number) => 4 + ((max - v) / range) * (PLOT_H - 8);
  const plotW = Math.max(0, width - PAD_L);
  const x = (i: number) => PAD_L + (growth.length > 1 ? (i * plotW) / (growth.length - 1) : plotW / 2);
  const pts = growth.map((g, i) => `${x(i).toFixed(1)},${y(g.pct30).toFixed(1)}`);
  const latest = growth[growth.length - 1];

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (growth.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = e.clientX - rect.left - PAD_L;
    const i = Math.round((rel / plotW) * (growth.length - 1));
    setHover(Math.max(0, Math.min(growth.length - 1, i)));
  };

  const ticks = [rawMax, (rawMax + rawMin) / 2, rawMin].filter(
    (v, i, a) => a.findIndex((w) => Math.abs(w - v) < 0.05) === i,
  );

  return (
    <div>
      <ChartTitle
        title="30-day growth rate"
        sub={latest ? `MRR growth over the 30 days ending each day · now ${signedPct(latest.pct30)}` : "Needs 30 days of history"}
      />
      <Tooltip>
        {active && (
          <>
            <span style={{ color: "var(--ink)", fontWeight: 650 }}>{longDay(active.date)}</span>
            <span style={{ color: "var(--ink)", fontWeight: 650 }}>{signedPct(active.pct30)} over 30 days</span>
          </>
        )}
      </Tooltip>
      <div
        ref={ref}
        style={{ position: "relative", height: PLOT_H, cursor: "crosshair" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {width > 0 && growth.length > 1 && (
          <svg width={width} height={PLOT_H} style={{ position: "absolute", inset: 0, display: "block", overflow: "visible" }}>
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD_L}
                  x2={width}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--chart-grid)"
                  strokeDasharray={Math.abs(t) < 1e-9 ? undefined : "2 4"}
                />
                <text x={PAD_L - 6} y={y(t) + 4} textAnchor="end" style={yLabelStyle()}>
                  {Math.abs(t) < 1e-9 ? "0%" : `${t.toFixed(1)}%`}
                </text>
              </g>
            ))}
            <path
              d={`M${x(0)},${y(Math.max(0, min))} L${pts.join(" L")} L${x(growth.length - 1)},${y(Math.max(0, min))} Z`}
              fill="var(--accent-soft)"
              opacity={0.7}
            />
            <polyline
              points={pts.join(" ")}
              fill="none"
              stroke="var(--chart-bar)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {active && hover != null && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={0} y2={PLOT_H} stroke="var(--line-2)" strokeWidth={1} />
                <circle
                  cx={x(hover)}
                  cy={y(active.pct30)}
                  r={4.5}
                  fill="var(--chart-bar)"
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              </>
            )}
            {!active && latest && (
              <circle
                cx={x(growth.length - 1)}
                cy={y(latest.pct30)}
                r={4}
                fill="var(--chart-bar)"
                stroke="var(--surface)"
                strokeWidth={2}
              />
            )}
          </svg>
        )}
      </div>
      <Ticks
        first={growth[0]?.date}
        mid={growth[Math.floor(growth.length / 2)]?.date}
        last={growth[growth.length - 1]?.date}
      />
    </div>
  );
}
