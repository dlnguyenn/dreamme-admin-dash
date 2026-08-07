"use client";

/**
 * Small shared pieces for the Overview screen. Formatters, an empty state that
 * matches the Resources/References dashed-border pattern, and the two
 * categorical series colors.
 */

import * as React from "react";

/**
 * Series colors for the two publishing sources.
 *
 * --cat-1 (terracotta) and --cat-3 (slate blue) rather than the adjacent
 * --cat-2 (muted green): green-vs-terracotta only reaches ΔE 6.6 under
 * protanopia, which is inside the "needs secondary encoding" floor band.
 * cat-1/cat-3 measures 12.5 (light) and 13.2 (dark). Colour still isn't the
 * only cue — the chart ships a legend and hover labels regardless.
 *
 * Fixed assignment by source name, never by rank: filtering to one source must
 * not repaint the survivor.
 */
export const SOURCE_COLOR: Record<string, string> = {
  doublespeed: "var(--cat-1)",
  sideshift: "var(--cat-3)",
};

export const SOURCE_LABEL: Record<string, string> = {
  doublespeed: "Doublespeed",
  sideshift: "Sideshift",
};

export const sourceColor = (s: string) => SOURCE_COLOR[s] ?? "var(--ink-4)";
export const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? s;

/**
 * Self-reported referral sources (users.referral_source) — a DIFFERENT axis
 * from the publishing sources above, so it gets its own maps rather than
 * overloading them.
 *
 * The option list belongs to the app's onboarding, not to us: `youtube`
 * appeared on 2026-08-07 with no change here. Both lookups therefore degrade
 * gracefully instead of assuming a fixed set. Colour is a secondary cue only —
 * every row is labelled in text.
 */
export const REFERRAL_COLOR: Record<string, string> = {
  tiktok: "var(--cat-1)",
  facebook: "var(--cat-3)",
  instagram: "var(--cat-4)",
  app_store: "var(--cat-2)",
  google: "var(--cat-5)",
  youtube: "var(--cat-7)",
  friend_family: "var(--cat-6)",
  other: "var(--cat-8)",
};

export const REFERRAL_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  facebook: "Facebook",
  instagram: "Instagram",
  app_store: "App Store",
  google: "Google",
  youtube: "YouTube",
  friend_family: "Friend / family",
  other: "Other",
};

export const referralColor = (s: string) => REFERRAL_COLOR[s] ?? "var(--ink-4)";

/** Unknown values are humanized: `some_new_source` → "Some new source". */
export const referralLabel = (s: string) =>
  REFERRAL_LABEL[s] ??
  s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

// ---- Formatters ---------------------------------------------------------

export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtMoney(n: number | null | undefined, dp = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`;
}

export function fmtPct(n: number | null | undefined, dp = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(dp)}%`;
}

/** "4h ago" / "2d ago". Absolute date once it's past a week. */
export function relTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ts = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).getTime();
  if (!Number.isFinite(ts)) return "—";
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Mon 4" — x-axis tick for the daily chart. */
export function shortDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ---- Empty state --------------------------------------------------------

export function EmptyState({
  title,
  children,
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px dashed var(--line-2)",
        borderRadius: 14,
        padding: "26px 22px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          font: "italic 400 15px var(--font-display)",
          color: "var(--ink-2)",
          marginBottom: children ? 6 : 0,
        }}
      >
        {title}
      </div>
      {children && (
        <div style={{ font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-4)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Quiet clickable "→ open the full tab" affordance used on every panel. */
export function GoToLink({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border: "none",
        background: "transparent",
        padding: 0,
        cursor: "pointer",
        font: "600 12.5px var(--font-ui)",
        color: hover ? "var(--accent-text)" : "var(--ink-3)",
        transition: "color 140ms ease",
        whiteSpace: "nowrap",
      }}
    >
      {label} →
    </button>
  );
}

/** Legend swatch + label. Identity is never colour-alone. */
export function LegendDot({ source }: { source: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        font: "500 12px var(--font-ui)",
        color: "var(--ink-2)",
      }}
    >
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: 3,
          background: sourceColor(source),
          flex: "none",
        }}
      />
      {sourceLabel(source)}
    </span>
  );
}
