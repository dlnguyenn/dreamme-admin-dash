"use client";

/**
 * Shared formatting + UI atoms for the Growth AI tab. Follows the dash's
 * inline-style conventions (serif numerals, mono eyebrows, CSS variables).
 */

import * as React from "react";

// --- formatting --------------------------------------------------------------

export function fmtUSD(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: abs >= 100 ? 0 : 2,
  });
}

export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtX(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}×`;
}

export function weeksSince(iso: string): number {
  const then = new Date(`${iso}T00:00:00Z`).getTime();
  return Math.max(1, Math.ceil((Date.now() - then) / (7 * 86_400_000)));
}

export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// --- atoms -------------------------------------------------------------------

export function SectionLabel({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: "var(--ink-3)",
        }}
      >
        {children}
      </div>
      {right}
    </div>
  );
}

/**
 * +12% / -18% pill. `goodWhen` flips the color semantics for cost metrics
 * (CPT going up is bad → red).
 */
export function DeltaChip({
  pct,
  goodWhen = "up",
}: {
  pct: number | null;
  goodWhen?: "up" | "down";
}) {
  if (pct == null || !Number.isFinite(pct)) return null;
  const up = pct >= 0;
  const good = goodWhen === "up" ? up : !up;
  const tone = good ? "var(--accent-2)" : "var(--accent)";
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "var(--font-geist-mono), monospace",
        padding: "2px 7px",
        borderRadius: 999,
        color: `color-mix(in oklab, ${tone} 85%, var(--ink))`,
        background: `color-mix(in oklab, ${tone} 14%, var(--surface))`,
        border: `1px solid color-mix(in oklab, ${tone} 30%, var(--line))`,
        whiteSpace: "nowrap",
      }}
    >
      {up ? "+" : ""}
      {Math.round(pct)}%
    </span>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  delta,
  goodWhen,
  hero,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  goodWhen?: "up" | "down";
  hero?: boolean;
}) {
  return (
    <div
      style={{
        padding: "18px 20px",
        borderRadius: 14,
        background: hero ? "var(--ink)" : "var(--surface)",
        color: hero ? "var(--surface)" : "var(--ink)",
        border: hero ? "1px solid var(--ink)" : "1px solid var(--line)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          opacity: hero ? 0.7 : 0.6,
          marginBottom: 8,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <div
          className="serif"
          style={{ fontSize: 30, fontWeight: 400, letterSpacing: "-0.025em", lineHeight: 1 }}
        >
          {value}
        </div>
        {delta !== undefined && <DeltaChip pct={delta ?? null} goodWhen={goodWhen} />}
      </div>
      {sub && (
        <div style={{ fontSize: 11, marginTop: 6, opacity: hero ? 0.65 : 1, color: hero ? undefined : "var(--ink-3)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  const active = status === "ACTIVE";
  const tone = active ? "var(--accent-2)" : "var(--ink-4)";
  return (
    <span
      title={status || "unknown"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
        fontFamily: "var(--font-geist-mono), monospace",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: tone,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: tone,
          boxShadow: active ? `0 0 0 3px color-mix(in oklab, ${tone} 20%, transparent)` : "none",
        }}
      />
      {active ? "Live" : status === "PAUSED" ? "Paused" : status.toLowerCase() || "—"}
    </span>
  );
}

export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginBottom: 16,
        padding: "10px 14px",
        fontSize: 13,
        color: "var(--accent)",
        background: "color-mix(in oklab, var(--accent) 10%, var(--surface))",
        border: "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
        borderRadius: 10,
      }}
    >
      {children}
    </div>
  );
}

export function Thumb({
  src,
  name,
  size = 44,
  radius = 8,
}: {
  src: string;
  name: string;
  size?: number;
  radius?: number;
}) {
  const w = size;
  const h = Math.round(size * 1.25);
  if (!src) {
    return (
      <div
        style={{
          width: w,
          height: h,
          borderRadius: radius,
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
          color: "var(--ink-4)",
          flexShrink: 0,
        }}
      >
        —
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      style={{
        width: w,
        height: h,
        borderRadius: radius,
        objectFit: "cover",
        border: "1px solid var(--line)",
        flexShrink: 0,
        display: "block",
      }}
    />
  );
}

// --- markdown-lite renderer ----------------------------------------------
// Renders the analyst's replies: headers, bullets, numbered lists, bold,
// inline code, and pipe tables. Deliberately tiny — no dependency.

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // split on **bold** and `code`
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  parts.forEach((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      out.push(
        <strong key={`${keyBase}-${i}`} style={{ fontWeight: 600, color: "var(--ink)" }}>
          {p.slice(2, -2)}
        </strong>,
      );
    } else if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
      out.push(
        <code
          key={`${keyBase}-${i}`}
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: "0.88em",
            background: "var(--surface-2)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            padding: "0 4px",
          }}
        >
          {p.slice(1, -1)}
        </code>,
      );
    } else if (p) {
      out.push(p);
    }
  });
  return out;
}

export function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // pipe table block
    if (line.trim().startsWith("|") && line.includes("|", 1)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const rows = tableLines
        .filter((l) => !/^\|[\s\-:|]+\|$/.test(l))
        .map((l) =>
          l
            .replace(/^\||\|$/g, "")
            .split("|")
            .map((c) => c.trim()),
        );
      if (rows.length > 0) {
        blocks.push(
          <div key={key++} style={{ overflowX: "auto", margin: "10px 0" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 320 }}>
              <thead>
                <tr>
                  {rows[0].map((c, ci) => (
                    <th
                      key={ci}
                      style={{
                        textAlign: ci === 0 ? "left" : "right",
                        padding: "6px 12px",
                        fontSize: 10,
                        fontFamily: "var(--font-geist-mono), monospace",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "var(--ink-3)",
                        borderBottom: "1px solid var(--line)",
                        background: "var(--surface-2)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1).map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, ci) => (
                      <td
                        key={ci}
                        style={{
                          textAlign: ci === 0 ? "left" : "right",
                          padding: "6px 12px",
                          borderBottom: "1px solid var(--line)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {renderInline(c, `t${ri}-${ci}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
      continue;
    }

    // headers
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      const level = h[1].length;
      blocks.push(
        <div
          key={key++}
          className={level <= 2 ? "serif" : undefined}
          style={{
            fontSize: level <= 2 ? 18 : 13.5,
            fontWeight: level <= 2 ? 400 : 600,
            letterSpacing: level <= 2 ? "-0.01em" : undefined,
            margin: "14px 0 4px",
            color: "var(--ink)",
          }}
        >
          {renderInline(h[2], `h${key}`)}
        </div>,
      );
      i++;
      continue;
    }

    // list block (bulleted or numbered)
    const isListLine = (l: string) => /^\s*([-*]|\d+[.)])\s+/.test(l);
    if (isListLine(line)) {
      const items: string[] = [];
      while (i < lines.length && isListLine(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} style={{ margin: "6px 0", paddingLeft: 20, display: "grid", gap: 4 }}>
          {items.map((it, ii) => (
            <li key={ii} style={{ lineHeight: 1.55 }}>
              {renderInline(it, `l${key}-${ii}`)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // paragraph
    blocks.push(
      <p key={key++} style={{ margin: "6px 0", lineHeight: 1.6 }}>
        {renderInline(line, `p${key}`)}
      </p>,
    );
    i++;
  }

  return <div style={{ fontSize: 13.5, color: "var(--ink-2)" }}>{blocks}</div>;
}
