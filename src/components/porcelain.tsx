"use client";

/**
 * Porcelain design-system primitives (design_handoff_porcelain).
 * Every color comes from tokens in globals.css — no literals here.
 * Component sheet (section 11 of the reference) is the acceptance spec.
 */

import * as React from "react";
import { Icons, type IconName } from "./Icons";

// ---- Semantic families -------------------------------------------------

export type Family =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "attention"
  | "neutral"
  | "accent";

export const fam = (k: Family) => ({
  solid: `var(--${k})`,
  soft: `var(--${k}-soft)`,
  text: `var(--${k}-text)`,
  onSolid: k === "accent" ? "var(--on-accent)" : "var(--on-solid)",
});

// ---- Tags: filled = category · outlined = source (never mix) ----------

export function CategoryTag({
  children,
  family,
  size = 10,
}: {
  children: React.ReactNode;
  family: Family;
  size?: number;
}) {
  const f = fam(family);
  return (
    <span
      style={{
        font: `700 ${size}px var(--font-ui)`,
        letterSpacing: "0.04em",
        background: f.soft,
        color: f.text,
        border: "1px solid transparent",
        padding: "3px 8px",
        borderRadius: 7,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function SourceTag({
  children,
  size = 10,
}: {
  children: React.ReactNode;
  size?: number;
}) {
  return (
    <span
      style={{
        font: `700 ${size}px var(--font-ui)`,
        letterSpacing: "0.04em",
        background: "transparent",
        color: "var(--ink-3)",
        border: "1px solid var(--line-2)",
        padding: "3px 8px",
        borderRadius: 7,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

// ---- Status pills ------------------------------------------------------

export function StatusPill({
  kind,
  children,
}: {
  kind: "running" | "attention" | "neutral" | "success" | "danger";
  children: React.ReactNode;
}) {
  const styles: Record<string, React.CSSProperties> = {
    running: { background: "var(--success-soft)", color: "var(--success-text)" },
    attention: { background: "var(--attention)", color: "var(--on-solid)" },
    neutral: { background: "var(--neutral-soft)", color: "var(--neutral-text)" },
    success: { background: "var(--success)", color: "var(--on-solid)" },
    danger: { background: "var(--danger-soft)", color: "var(--danger-text)" },
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        font: "700 10.5px var(--font-ui)",
        letterSpacing: "0.05em",
        padding: "5px 11px",
        borderRadius: 999,
        flex: "none",
        whiteSpace: "nowrap",
        ...styles[kind],
      }}
    >
      {kind === "running" && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: "var(--success)",
            animation: "dmPulse 2s infinite",
          }}
        />
      )}
      {children}
    </span>
  );
}

// ---- Filter pills (selected = ink fill · idle = outlined ghost) --------

export function FilterPill({
  label,
  count,
  selected,
  attention,
  countFamily,
  onClick,
}: {
  label: React.ReactNode;
  count?: React.ReactNode;
  selected?: boolean;
  /** "needs action" gold count badge */
  attention?: boolean;
  /** color the count badge by a semantic family (idle pills only) */
  countFamily?: Family;
  onClick?: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  const badgeBg = selected
    ? "var(--surface)"
    : attention
      ? "var(--attention-soft)"
      : countFamily
        ? fam(countFamily).soft
        : "var(--neutral-soft)";
  const badgeFg = selected
    ? "var(--ink)"
    : attention
      ? "var(--attention-text)"
      : countFamily
        ? fam(countFamily).text
        : "var(--ink-3)";
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "6.5px 13px",
        borderRadius: 999,
        background: selected
          ? "var(--ink)"
          : hover
            ? "var(--neutral-soft)"
            : "transparent",
        color: selected ? "var(--bg)" : "var(--ink-2)",
        border: selected
          ? "1px solid var(--ink)"
          : `1px solid ${hover ? "var(--ink-4)" : "var(--line-2)"}`,
        fontFamily: "var(--font-ui)",
        fontSize: 13,
        fontWeight: selected ? 650 : 500,
        cursor: "pointer",
        transition: "background 140ms ease, border-color 140ms ease",
        whiteSpace: "nowrap",
      }}
    >
      {label}
      {count != null && count !== "" && (
        <span
          style={{
            font: "650 11px var(--font-ui)",
            fontVariantNumeric: "tabular-nums",
            background: badgeBg,
            color: badgeFg,
            padding: "1.5px 7px",
            borderRadius: 999,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ---- Segmented control (view tabs) -------------------------------------

export function Segmented({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: string; label: React.ReactNode }[];
  value: string;
  onChange: (v: string) => void;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "5px 12px" : "7px 15px";
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--bg-2)",
        borderRadius: 12,
        padding: 3,
        gap: 2,
      }}
    >
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: pad,
              borderRadius: 9,
              border: "none",
              background: sel ? "var(--surface)" : "transparent",
              boxShadow: sel ? "var(--shadow-xs)" : "none",
              font: `${sel ? 650 : 500} 13px var(--font-ui)`,
              color: sel ? "var(--ink)" : "var(--ink-2)",
              cursor: "pointer",
              transition: "background 140ms ease, color 140ms ease",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              if (!sel) e.currentTarget.style.color = "var(--ink)";
            }}
            onMouseLeave={(e) => {
              if (!sel) e.currentTarget.style.color = "var(--ink-2)";
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- Section anchor: 26px solid tile + h3 (one per section) ------------

export function SectionHeader({
  family,
  icon,
  title,
  meta,
  right,
  style,
}: {
  family: Family;
  icon: IconName;
  title: React.ReactNode;
  meta?: React.ReactNode;
  right?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const f = fam(family);
  const IconComp = Icons[icon];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        margin: "34px 0 12px",
        ...style,
      }}
    >
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: 8,
          background: f.solid,
          color: f.onSolid,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        <IconComp size={14} strokeWidth={2} />
      </span>
      <h3 style={{ font: "650 15px var(--font-ui)", margin: 0 }}>{title}</h3>
      {meta && (
        <span style={{ font: "400 13px var(--font-ui)", color: "var(--ink-3)" }}>
          {meta}
        </span>
      )}
      {right && <span style={{ marginLeft: "auto" }}>{right}</span>}
    </div>
  );
}

// ---- KPI delta chip: arrow = direction · color = sentiment -------------

export function DeltaChip({
  children,
  family,
  size = 12.5,
}: {
  children: React.ReactNode;
  family: Family;
  size?: number;
}) {
  const f = fam(family);
  return (
    <span
      style={{
        font: `650 ${size}px var(--font-ui)`,
        fontVariantNumeric: "tabular-nums",
        background: f.soft,
        color: f.text,
        padding: "3px 9px",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

// ---- Card: hairline-defined surface ------------------------------------

export function Card({
  children,
  style,
  pad = "18px 20px",
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  pad?: string | number;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        padding: pad,
        boxShadow: "var(--shadow-card)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ---- Severity icon tile (30px, soft fill) — anomaly rows ---------------

export type Severity = "critical" | "notable" | "info";

const SEV_META: Record<Severity, { family: Family; icon: IconName }> = {
  critical: { family: "danger", icon: "Octagon" },
  notable: { family: "warning", icon: "TriAlert" },
  info: { family: "info", icon: "InfoCircle" },
};

export function SeverityTile({ severity }: { severity: Severity }) {
  const { family, icon } = SEV_META[severity];
  const f = fam(family);
  const IconComp = Icons[icon];
  return (
    <span
      style={{
        width: 30,
        height: 30,
        borderRadius: 9,
        background: f.soft,
        color: f.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      <IconComp size={16} strokeWidth={1.8} />
    </span>
  );
}

export const severityTextColor = (s: Severity) =>
  `var(--${SEV_META[s].family}-text)`;

// ---- Initials avatar: persona-hue pair, gray for system senders ---------
// Porcelain avatar pairs (handoff-specified oklch; theme-aware via
// light-dark(), which follows the color-scheme set on :root/[data-theme]).

export function hueFromName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 37 + name.charCodeAt(i)) % 360;
  return h;
}

export function InitialsAvatar({
  name,
  hue,
  size = 32,
}: {
  name: string;
  /** null = neutral gray (system senders) */
  hue?: number | null;
  size?: number;
}) {
  const words = name.match(/[A-Za-z]+/g) ?? ["?"];
  const initials = (
    words[0][0] + (words[1] ? words[1][0] : "")
  ).toUpperCase();
  const bg =
    hue == null
      ? "var(--neutral-soft)"
      : `light-dark(oklch(93% 0.04 ${hue}), oklch(30% 0.06 ${hue}))`;
  const fg =
    hue == null
      ? "var(--neutral-text)"
      : `light-dark(oklch(38% 0.11 ${hue}), oklch(86% 0.08 ${hue}))`;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: bg,
        color: fg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        font: `700 ${Math.round(size * 0.375)}px var(--font-ui)`,
        flex: "none",
      }}
    >
      {initials}
    </span>
  );
}

// ---- Sparkline: area + line, semantic color -----------------------------

export function Sparkline({
  values,
  family,
  height = 30,
}: {
  values: number[];
  /** null = neutral gray */
  family?: Family | null;
  height?: number;
}) {
  if (values.length < 2) return null;
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const rg = mx - mn || 1;
  const pts = values.map(
    (v, i) =>
      `${((i * 200) / (values.length - 1)).toFixed(1)},${(
        30 -
        ((v - mn) / rg) * 24 +
        3
      ).toFixed(1)}`,
  );
  const line = pts.join(" ");
  const area = `M0,36 L${pts.join(" L")} L200,36 Z`;
  const stroke = family ? `var(--${family})` : "var(--ink-4)";
  const fill = family ? `var(--${family}-soft)` : "var(--neutral-soft)";
  return (
    <svg
      viewBox="0 0 200 36"
      preserveAspectRatio="none"
      style={{ width: "100%", height, display: "block" }}
    >
      <path d={area} fill={fill} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---- KPI cards ----------------------------------------------------------

export function KpiCard({
  label,
  value,
  delta,
  deltaFamily,
  spark,
  sparkFamily,
  note,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: React.ReactNode;
  deltaFamily?: Family;
  spark?: number[];
  sparkFamily?: Family | null;
  note?: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        padding: "18px 20px",
        boxShadow: "var(--shadow-card)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
      }}
    >
      <div
        style={{
          font: "650 11px var(--font-ui)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--ink-3)",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span
          style={{
            font: "700 34px/1 var(--font-ui)",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.01em",
            color: "var(--ink)",
          }}
        >
          {value}
        </span>
        {delta != null && deltaFamily && (
          <DeltaChip family={deltaFamily}>{delta}</DeltaChip>
        )}
      </div>
      {spark && spark.length > 1 && (
        <Sparkline values={spark} family={sparkFamily} />
      )}
      {note && (
        <div style={{ font: "400 12px var(--font-ui)", color: "var(--ink-4)" }}>
          {note}
        </div>
      )}
    </div>
  );
}

/** One hero card max per screen (near-black, white number). */
export function HeroCard({
  label,
  value,
  delta,
  deltaUp,
  spark,
  note,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  delta?: React.ReactNode;
  /** true = positive sentiment chip color */
  deltaUp?: boolean;
  spark?: number[];
  note?: React.ReactNode;
}) {
  let sparkSvg: React.ReactNode = null;
  if (spark && spark.length > 1) {
    const mn = Math.min(...spark);
    const mx = Math.max(...spark);
    const rg = mx - mn || 1;
    const pts = spark.map(
      (v, i) =>
        `${((i * 200) / (spark.length - 1)).toFixed(1)},${(
          30 -
          ((v - mn) / rg) * 24 +
          3
        ).toFixed(1)}`,
    );
    sparkSvg = (
      <svg
        viewBox="0 0 200 36"
        preserveAspectRatio="none"
        style={{ width: "100%", height: 30, display: "block" }}
      >
        <path
          d={`M0,36 L${pts.join(" L")} L200,36 Z`}
          fill="rgba(255,255,255,0.10)"
        />
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke="rgba(255,255,255,0.75)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <div
      style={{
        background: "var(--hero-bg)",
        color: "var(--hero-ink)",
        borderRadius: 16,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
      }}
    >
      <div
        style={{
          font: "650 11px var(--font-ui)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--hero-mut)",
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span
          style={{
            font: "700 34px/1 var(--font-ui)",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.01em",
          }}
        >
          {value}
        </span>
        {delta != null && (
          <span
            style={{
              font: "650 12.5px var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              background: "var(--hero-chip-bg)",
              color: deltaUp ? "var(--hero-chip-up)" : "var(--hero-chip-down)",
              padding: "3px 8px",
              borderRadius: 999,
            }}
          >
            {delta}
          </span>
        )}
      </div>
      {sparkSvg}
      {note && (
        <div style={{ font: "400 12px var(--font-ui)", color: "var(--hero-mut)" }}>
          {note}
        </div>
      )}
    </div>
  );
}

// ---- Flat stat strip: ONE card, hairline column dividers ----------------

export function StatStrip({
  stats,
  minColWidth = 150,
}: {
  stats: {
    label: React.ReactNode;
    value: React.ReactNode;
    delta?: React.ReactNode;
    deltaFamily?: Family;
    note?: React.ReactNode;
  }[];
  minColWidth?: number;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${minColWidth}px, 1fr))`,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      {stats.map((s, i) => (
        <div
          key={i}
          style={{
            padding: "16px 18px",
            borderLeft: i ? "1px solid var(--line)" : "none",
            display: "flex",
            flexDirection: "column",
            gap: 7,
            minWidth: 0,
          }}
        >
          <div
            style={{
              font: "650 10.5px var(--font-ui)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {s.label}
          </div>
          <div
            style={{
              font: "700 26px/1 var(--font-ui)",
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.01em",
              color: "var(--ink)",
            }}
          >
            {s.value}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minHeight: 20,
            }}
          >
            {s.delta != null && s.deltaFamily && (
              <DeltaChip family={s.deltaFamily} size={12}>
                {s.delta}
              </DeltaChip>
            )}
            {s.note && (
              <span
                style={{
                  font: "400 11px var(--font-ui)",
                  color: "var(--ink-4)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {s.note}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Table cell styles (uppercase header, hairline rows) ----------------

export const thStyle = (align: "left" | "right" | "center" = "right") =>
  ({
    textAlign: align,
    padding: "10px 16px",
    font: "650 10.5px var(--font-ui)",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--ink-3)",
    borderBottom: "1px solid var(--line)",
    whiteSpace: "nowrap",
  }) as React.CSSProperties;

// ---- Info well (quiet explainer block) ----------------------------------

export function InfoWell({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        padding: "12px 16px",
        font: "400 12.5px/1.55 var(--font-ui)",
        color: "var(--ink-3)",
        background: "var(--surface-2)",
        borderRadius: 12,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ---- Error banner --------------------------------------------------------

export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginBottom: 16,
        padding: "10px 14px",
        font: "400 13px var(--font-ui)",
        color: "var(--danger-text)",
        background: "var(--danger-soft)",
        borderRadius: 10,
      }}
    >
      {children}
    </div>
  );
}
