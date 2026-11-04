/** Formatters shared by the April Plan and Meta Switchback screens. */
import type { CSSProperties } from "react";

const isNum = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

/** $1,234 at 100+, $12.34 below; "—" when missing. */
export function usd(n: number | null | undefined, digits?: number): string {
  if (!isNum(n)) return "—";
  const d = digits ?? (Math.abs(n) >= 100 ? 0 : 2);
  return `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export const pct = (x: number | null | undefined, digits = 1) => (isNum(x) ? `${(x * 100).toFixed(digits)}%` : "—");

export const int = (n: number | null | undefined) => (isNum(n) ? Math.round(n).toLocaleString("en-US") : "—");

export const one = (n: number | null | undefined) => (isNum(n) ? (Math.round(n * 10) / 10).toFixed(1) : "—");

/** Signed, one decimal: +3.2 / −1.0. */
export const signed = (n: number | null | undefined) => (isNum(n) ? `${n >= 0 ? "+" : "−"}${one(Math.abs(n))}` : "—");

/** "Nov 2" from YYYY-MM-DD. */
export function shortDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Style for a Card wrapping a wide table. <main> is a flex item with
 * min-width auto, so without inline-size containment a wide table's
 * min-content width stretches the whole page past the viewport instead of
 * scrolling inside the card.
 */
export const tableCard: CSSProperties = { overflowX: "auto", contain: "inline-size" };

export const tdStyle =(align: "left" | "right" = "right"): CSSProperties => ({
  padding: "8px 16px",
  font: "400 13px var(--font-ui)",
  fontVariantNumeric: "tabular-nums",
  textAlign: align,
  borderTop: "1px solid var(--line)",
  whiteSpace: "nowrap",
});
