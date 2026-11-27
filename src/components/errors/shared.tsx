"use client";

import * as React from "react";

export const ago = (iso: string | null | undefined, now = Date.now()) => {
  if (!iso) return "never";
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const n = (v: number) => v.toLocaleString("en-US");

/** "com.dreamme.app@1.5.9+1.0.95" -> "1.5.9 (1.0.95)" */
export const shortRelease = (r: string | null | undefined) => {
  if (!r) return "—";
  const m = r.match(/@([^+]+)(?:\+(.+))?$/);
  return m ? (m[2] ? `${m[1]} (${m[2]})` : m[1]) : r;
};

export const PLATFORM_LABEL: Record<string, string> = {
  javascript: "JavaScript",
  cocoa: "iOS native",
  java: "Android native",
  native: "Native",
};

/** Daily events as bars. Real counts, so the tallest bar is the busiest day. */
export function Bars({ values, height = 22, width = 84, highlightLast, fluid }: { values: number[]; height?: number; width?: number; highlightLast?: boolean; fluid?: boolean }) {
  const max = Math.max(1, ...values);
  const gap = 1.5;
  const w = (width - gap * (values.length - 1)) / values.length;
  return (
    <svg
      width={fluid ? "100%" : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? "none" : undefined}
      role="img"
      aria-label={`Daily events: ${values.join(", ")}`}
      style={{ display: "block" }}
    >
      {values.map((v, i) => {
        const h = v === 0 ? 1.5 : Math.max(2, (v / max) * height);
        const last = i === values.length - 1;
        return (
          <rect
            key={i}
            x={i * (w + gap)}
            y={height - h}
            width={w}
            height={h}
            rx={1}
            fill={v === 0 ? "var(--line-2)" : last && highlightLast ? "var(--danger)" : "var(--chart-bar)"}
          />
        );
      })}
    </svg>
  );
}

/** Plain coloured words, not pills: they label, they don't do anything. */
export function Flag({ kind, children }: { kind: "danger" | "warning" | "info" | "neutral"; children: React.ReactNode }) {
  const color = { danger: "var(--danger-text)", warning: "var(--warning-text, var(--warning))", info: "var(--info)", neutral: "var(--ink-3)" }[kind];
  return <span style={{ font: "650 12px var(--font-ui)", color, whiteSpace: "nowrap" }}>{children}</span>;
}
