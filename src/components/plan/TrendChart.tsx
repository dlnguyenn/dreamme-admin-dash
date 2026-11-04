"use client";

/**
 * One-series trend chart for the April Plan and Meta Switchback screens:
 * a 2px line with point markers, labelled horizontal reference lines, an
 * optional value band and optional shaded x-ranges (test arms), plus a
 * crosshair tooltip on hover. Nulls are gaps, never zeros.
 *
 * One series per chart on purpose: the Porcelain category tokens cannot give
 * three lines that stay apart for colour-blind readers, so per-source views
 * are small multiples, each named by its title.
 */

import * as React from "react";
import { shortDate } from "./format";

export interface TrendPoint {
  x: string; // YYYY-MM-DD
  y: number | null;
  /** Extra tooltip line, e.g. "412 trials". */
  note?: string;
  /** Drawn hollow: provisional value. */
  provisional?: boolean;
}

export interface RefLine {
  y: number;
  label: string;
  dashed?: boolean;
}

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

export function TrendChart({
  points,
  color,
  format,
  ariaLabel,
  refs = [],
  band,
  shade = [],
  height = 170,
  yFloor = 0,
}: {
  points: TrendPoint[];
  /** A token, e.g. "var(--cat-3)". */
  color: string;
  format: (v: number) => string;
  ariaLabel: string;
  refs?: RefLine[];
  band?: { y0: number; y1: number; label: string };
  shade?: { from: string; to: string; label: string }[];
  height?: number;
  /** Lowest value the axis must show (null = fit the data). */
  yFloor?: number | null;
}) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(520);
  const [hover, setHover] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const values = points.map((p) => p.y).filter((v): v is number => v != null && Number.isFinite(v));
  const all = [...values, ...refs.map((r) => r.y), ...(band ? [band.y0, band.y1] : []), ...(yFloor != null ? [yFloor] : [])];
  if (points.length < 2 || !values.length) {
    return (
      <div ref={boxRef} style={{ height, display: "flex", alignItems: "center", justifyContent: "center", font: "400 12px var(--font-ui)", color: "var(--ink-4)" }}>
        Not enough mature data yet
      </div>
    );
  }
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi === lo) hi = lo + 1;
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(Number(t.toFixed(6)));

  const padL = 46;
  // Reference and band labels sit in a right gutter, clear of the data.
  const gutter = refs.length || band ? 104 : 0;
  const padR = 12 + gutter;
  const padT = 14;
  const padB = 24;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const xStep = plotW / Math.max(1, points.length - 1);
  const xAt = (i: number) => padL + i * xStep;
  const yAt = (v: number) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;
  const indexOf = (d: string) => points.findIndex((p) => p.x === d);

  // Consecutive non-null runs, each its own polyline.
  const runs: number[][] = [];
  let run: number[] = [];
  points.forEach((p, i) => {
    if (p.y == null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push(i);
  });
  if (run.length) runs.push(run);

  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 64))));

  // Gutter labels, nudged apart so two close lines never print on top of each other.
  const gutterLabels = [
    ...refs.map((r) => ({ y: yAt(r.y), text: r.label, strong: !r.dashed })),
    ...(band ? [{ y: yAt((band.y0 + band.y1) / 2), text: band.label, strong: false }] : []),
  ].sort((a, b) => a.y - b.y);
  for (let i = 1; i < gutterLabels.length; i++) {
    if (gutterLabels[i].y - gutterLabels[i - 1].y < 12) gutterLabels[i].y = gutterLabels[i - 1].y + 12;
  }
  const hp = hover != null ? points[hover] : null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * width;
    const i = Math.round((x - padL) / xStep);
    setHover(i >= 0 && i < points.length ? i : null);
  };

  return (
    <div ref={boxRef} style={{ position: "relative", width: "100%" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: "block", overflow: "visible" }}
      >
        {shade.map((s, k) => {
          const a = indexOf(s.from);
          const b = indexOf(s.to);
          if (a < 0 && b < 0) return null;
          const x0 = Math.max(padL, xAt(a < 0 ? 0 : a) - xStep / 2);
          const x1 = Math.min(width - padR, xAt(b < 0 ? points.length - 1 : b) + xStep / 2);
          return (
            <g key={`s${k}`}>
              <rect x={x0} y={padT} width={Math.max(0, x1 - x0)} height={plotH} fill="var(--bg-2)" opacity={0.55} />
              <text x={x0 + 4} y={padT + 10} style={{ font: "600 9.5px var(--font-ui)", fill: "var(--ink-3)", letterSpacing: "0.04em" }}>
                {s.label}
              </text>
            </g>
          );
        })}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={yAt(t)} y2={yAt(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={padL - 6} y={yAt(t) + 3.5} textAnchor="end" style={{ font: "400 10.5px var(--font-ui)", fill: "var(--ink-4)", fontVariantNumeric: "tabular-nums" }}>
              {format(t)}
            </text>
          </g>
        ))}
        {band && (
          <g>
            <rect
              x={padL}
              y={yAt(band.y1)}
              width={plotW}
              height={Math.max(1, yAt(band.y0) - yAt(band.y1))}
              fill="var(--neutral-soft)"
              opacity={0.9}
            />
          </g>
        )}
        {refs.map((r, k) => (
          <line
            key={`r${k}`}
            x1={padL}
            x2={width - padR}
            y1={yAt(r.y)}
            y2={yAt(r.y)}
            stroke={r.dashed ? "var(--ink-4)" : "var(--ink-2)"}
            strokeWidth={r.dashed ? 1 : 1.5}
            strokeDasharray={r.dashed ? "4 4" : undefined}
          />
        ))}
        {gutterLabels.map((g, k) => (
          <text
            key={`g${k}`}
            x={width - padR + 6}
            y={g.y + 3.5}
            style={{ font: `${g.strong ? 600 : 400} 10.5px var(--font-ui)`, fill: g.strong ? "var(--ink-2)" : "var(--ink-3)" }}
          >
            {g.text}
          </text>
        ))}
        {runs.map((r, k) =>
          r.length > 1 ? (
            <polyline
              key={`l${k}`}
              points={r.map((i) => `${xAt(i).toFixed(1)},${yAt(points[i].y!).toFixed(1)}`).join(" ")}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null,
        )}
        {points.map((p, i) =>
          p.y == null ? null : (
            <circle
              key={`p${i}`}
              cx={xAt(i)}
              cy={yAt(p.y)}
              r={hover === i ? 5 : 4}
              fill={p.provisional ? "var(--surface)" : color}
              stroke={p.provisional ? color : "var(--surface)"}
              strokeWidth={2}
            />
          ),
        )}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={`x${i}`} x={xAt(i)} y={height - 6} textAnchor="middle" style={{ font: "400 10.5px var(--font-ui)", fill: "var(--ink-4)" }}>
              {shortDate(p.x)}
            </text>
          ) : null,
        )}
        {hp && hover != null && <line x1={xAt(hover)} x2={xAt(hover)} y1={padT} y2={padT + plotH} stroke="var(--ink-4)" strokeWidth={1} />}
      </svg>
      {hp && hover != null && (
        <div
          style={{
            position: "absolute",
            top: 4,
            left: Math.min(Math.max(0, xAt(hover) + 10), width - 150),
            minWidth: 120,
            padding: "7px 10px",
            background: "var(--surface)",
            border: "1px solid var(--line-2)",
            borderRadius: 9,
            boxShadow: "var(--shadow-card)",
            font: "400 12px var(--font-ui)",
            color: "var(--ink-2)",
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          <div style={{ font: "600 11px var(--font-ui)", color: "var(--ink-3)" }}>{shortDate(hp.x)}</div>
          <div style={{ font: "650 14px var(--font-ui)", color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
            {hp.y == null ? "no data" : format(hp.y)}
            {hp.provisional ? " (early)" : ""}
          </div>
          {hp.note && <div style={{ color: "var(--ink-3)" }}>{hp.note}</div>}
        </div>
      )}
    </div>
  );
}
