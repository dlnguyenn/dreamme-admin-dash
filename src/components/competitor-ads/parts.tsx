"use client";

/**
 * Small pieces shared by the Competitor ads tab and its drawer. Tokens only,
 * sentence-case labels, hairline rows in tables, no pills for labels.
 */

import * as React from "react";
import type { AdView, FormatMix } from "@/lib/competitor-ads-tab/logic";

export const num = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
export const rankText = (n: number | null | undefined) => (n == null ? "—" : `#${n}`);
export const pctText = (x: number | null | undefined) => (x == null ? "—" : `${Math.round(x * 100)}%`);
export const shortDay = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—";
export const monthLabel = (ym: string) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
/** "Aug", with the year on the first bar and on January ("Jan 2026"), so a bar never reads as a date. */
const barLabel = (ym: string, first: boolean) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", ...(first || ym.endsWith("-01") ? { year: "numeric" } : {}), timeZone: "UTC" });

// ---------------------------------------------------------------- table

export const cell: React.CSSProperties = {
  padding: "9px 14px 9px 0",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
  borderTop: "1px solid var(--line)",
  verticalAlign: "middle",
  font: "400 13px var(--font-ui)",
  color: "var(--ink)",
};
export const head: React.CSSProperties = {
  ...cell,
  borderTop: "none",
  font: "600 12px var(--font-ui)",
  color: "var(--ink-3)",
  whiteSpace: "nowrap",
  paddingBottom: 6,
};
export const left: React.CSSProperties = { textAlign: "left" };

export function TableBox({ children, minWidth = 720 }: { children: React.ReactNode; minWidth?: number }) {
  return (
    <div style={{ overflowX: "auto", contain: "inline-size", WebkitOverflowScrolling: "touch" }}>
      <table style={{ width: "100%", minWidth, borderCollapse: "collapse" }}>{children}</table>
    </div>
  );
}

/** Rank move as words in colour: up is good (smaller number). */
export function Move({ now, before, runDays }: { now: number | null; before: number | null; runDays: number | null }) {
  if (now == null) return <span style={{ color: "var(--ink-3)" }}>—</span>;
  if (before == null) {
    // Only a young ad is "new"; an older one simply wasn't in that day's list.
    return runDays != null && runDays <= 8 ? <span style={{ color: "var(--info-text)" }}>new</span> : <span style={{ color: "var(--ink-3)" }}>unranked</span>;
  }
  const d = before - now;
  if (d === 0) return <span style={{ color: "var(--ink-3)" }}>same</span>;
  return <span style={{ color: d > 0 ? "var(--success-text)" : "var(--danger-text)" }}>{d > 0 ? `up ${d}` : `down ${-d}`}</span>;
}

// ---------------------------------------------------------------- ad cell

const MEDIA_LABEL: Record<AdView["mediaType"], string> = { video: "Video", dco: "DCO", image: "Image", none: "No creative yet" };
export const mediaLabel = (m: AdView["mediaType"]) => MEDIA_LABEL[m];

export function Thumb({ ad, size = 44 }: { ad: AdView; size?: number }) {
  const [broken, setBroken] = React.useState(false);
  const box: React.CSSProperties = {
    width: size,
    height: Math.round(size * 1.25),
    borderRadius: 6,
    flex: "none",
    background: "var(--bg-2)",
    objectFit: "cover",
    display: "block",
  };
  if (!ad.thumb || broken) return <span aria-hidden style={box} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={ad.thumb} alt="" loading="lazy" style={box} onError={() => setBroken(true)} />;
}

export function adHeadline(ad: AdView): string {
  return (ad.hook || ad.title || ad.body || "Untitled ad").replace(/\s+/g, " ").trim();
}

export function AdCell({ ad, showBrand }: { ad: AdView; showBrand?: boolean }) {
  return (
    <span style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
      <Thumb ad={ad} />
      <span style={{ minWidth: 0, display: "block" }}>
        <span
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            font: "500 13px/1.35 var(--font-ui)",
            color: "var(--ink)",
            maxWidth: 420,
          }}
        >
          {adHeadline(ad)}
        </span>
        <span style={{ display: "block", font: "400 12px var(--font-ui)", color: "var(--ink-3)", marginTop: 2 }}>
          {showBrand ? `${ad.brand} · ` : ""}
          {ad.identity} · {mediaLabel(ad.mediaType)}
        </span>
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- format mix

const MIX: { key: keyof FormatMix; label: string; color: string }[] = [
  { key: "video", label: "Video", color: "var(--cat-1)" },
  { key: "dco", label: "DCO", color: "var(--cat-3)" },
  { key: "image", label: "Image", color: "var(--cat-5)" },
  { key: "none", label: "No creative yet", color: "var(--line-2)" },
];

export function MixBar({ mix }: { mix: FormatMix }) {
  const total = mix.video + mix.dco + mix.image + mix.none;
  if (!total) return <span style={{ color: "var(--ink-3)", font: "400 13px var(--font-ui)" }}>No live ads</span>;
  return (
    <div>
      <div role="img" aria-label={MIX.map((m) => `${m.label} ${mix[m.key]}`).join(", ")} style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--bg-2)", gap: 1 }}>
        {MIX.filter((m) => mix[m.key] > 0).map((m) => (
          <span key={m.key} style={{ flex: mix[m.key], background: m.color }} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 8 }}>
        {MIX.filter((m) => mix[m.key] > 0).map((m) => (
          <span key={m.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "400 12px var(--font-ui)", color: "var(--ink-2)" }}>
            <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: m.color }} />
            {m.label} <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>{mix[m.key]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- rank line (lower is better, drawn top)

export function RankLine({ points, height = 120 }: { points: { day: string; rank: number }[]; height?: number }) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(480);
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(220, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (points.length < 2) {
    return <div style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>{points.length ? `Ranked once so far: #${points[0].rank} on ${shortDay(points[0].day)}` : "Not ranked yet"}</div>;
  }
  const padL = 36;
  const padR = 8;
  const padT = 8;
  const padB = 20;
  const worst = Math.max(...points.map((p) => p.rank));
  const top = 1;
  const bottom = Math.max(10, worst);
  const x = (i: number) => padL + (i / (points.length - 1)) * (width - padL - padR);
  const y = (r: number) => padT + ((r - top) / (bottom - top || 1)) * (height - padT - padB);
  const ticks = [1, Math.round(bottom / 2), bottom];
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`).join(" ");
  return (
    <div ref={boxRef} style={{ position: "relative", height }}>
      <svg width={width} height={height} role="img" aria-label={`Delivery rank by day, from #${points[0].rank} to #${points.at(-1)!.rank}`} style={{ position: "absolute", inset: 0 }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" style={{ font: "400 11px var(--font-ui)", fill: "var(--ink-3)" }}>
              #{t}
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={p.day} cx={x(i)} cy={y(p.rank)} r={2.5} fill="var(--accent)">
            <title>{`${shortDay(p.day)}: #${p.rank}`}</title>
          </circle>
        ))}
        <text x={padL} y={height - 4} style={{ font: "400 11px var(--font-ui)", fill: "var(--ink-3)" }}>
          {shortDay(points[0].day)}
        </text>
        <text x={width - padR} y={height - 4} textAnchor="end" style={{ font: "400 11px var(--font-ui)", fill: "var(--ink-3)" }}>
          {shortDay(points.at(-1)!.day)}
        </text>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------- month bars

export function MonthBars({ months, height = 140 }: { months: { month: string; launched: number }[]; height?: number }) {
  const max = Math.max(1, ...months.map((m) => m.launched));
  return (
    <div role="img" aria-label={months.map((m) => `${monthLabel(m.month)}: ${m.launched} launched`).join(", ")} style={{ display: "flex", alignItems: "flex-end", gap: 6, height, paddingTop: 18 }}>
      {months.map((m) => (
        <div key={m.month} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
          <span style={{ font: "400 11px var(--font-ui)", color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>{m.launched}</span>
          <span style={{ width: "100%", maxWidth: 34, height: `${(m.launched / max) * (height - 46)}px`, minHeight: m.launched ? 2 : 0, background: "var(--chart-bar)", borderRadius: "3px 3px 0 0" }} />
          <span style={{ font: "400 11px var(--font-ui)", color: "var(--ink-3)", whiteSpace: "nowrap" }}>{barLabel(m.month, m === months[0])}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- headings and notes

export function H2({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", margin: "28px 0 10px" }}>
      <h2 style={{ font: "650 15px var(--font-ui)", margin: 0, color: "var(--ink)" }}>{children}</h2>
      {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
    </div>
  );
}

export function Note({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <p style={{ font: "400 13px/1.5 var(--font-ui)", color: "var(--ink-2)", margin: "0 0 12px", maxWidth: 760, ...style }}>{children}</p>;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div style={{ border: "1px dashed var(--line-2)", borderRadius: 14, padding: "26px 22px", textAlign: "center" }}>
      <div style={{ font: "500 15px var(--font-ui)", color: "var(--ink)" }}>{title}</div>
      {children && <div style={{ font: "400 13px/1.5 var(--font-ui)", color: "var(--ink-2)", marginTop: 6, maxWidth: 520, marginInline: "auto" }}>{children}</div>}
    </div>
  );
}
