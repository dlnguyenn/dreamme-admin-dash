/**
 * App Analytics tab: types and pure helpers (safe for the client bundle).
 *
 * The tab shows one dated report: how people use the app, what keeps them
 * paying, why they cancel, and how far each event can be trusted. A report is
 * a list of views, each a list of sections, each a list of blocks (a table, a
 * bar list, small-multiple charts, findings and so on).
 *
 * The figures are stored in the `app_analytics_snapshots` table, never in this
 * repo, which is public. Request checks: src/lib/app-analytics-schema.ts.
 * Storage: /api/app-analytics.
 */

export const EVIDENCE = ["measured", "correlational", "guess"] as const;
export type Evidence = (typeof EVIDENCE)[number];

export const EVIDENCE_LABELS: Record<Evidence, string> = {
  measured: "Measured",
  correlational: "Correlational",
  guess: "Guess",
};

export const EVIDENCE_HINTS: Record<Evidence, string> = {
  measured: "Counted directly from the data",
  correlational: "These go together; the cause is not shown",
  guess: "An estimate, not a count",
};

export const TONES = ["good", "warn", "bad", "info", "neutral"] as const;
export type Tone = (typeof TONES)[number];

/** A short state with a colour that means something: a verdict, a fix's progress. */
export interface StatusChip {
  status: string;
  tone: Tone;
}

export interface StatItem {
  label: string;
  value: string;
  note?: string;
}

export interface FindingItem {
  title: string;
  body?: string;
  evidence?: Evidence;
  status?: StatusChip;
}

export const COLUMN_KINDS = ["text", "num", "bar", "status"] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];

export interface TableColumn {
  label: string;
  /** text (default), a right-aligned number, a number with a bar, or a status. */
  kind?: ColumnKind;
  /** "%" prints 12.5%; "pts" prints a signed +3; anything else is appended. */
  unit?: string;
  /** Top of a bar column's scale. Defaults to the largest value in the column. */
  max?: number;
}

export type TableCell = string | number | null | StatusChip;

export interface BarRow {
  label: string;
  value: number;
  note?: string;
  /** When any row is marked, the others are drawn in the quiet colour. */
  emphasis?: boolean;
}

export interface Series {
  label: string;
  values: number[];
}

interface BlockBase {
  title?: string;
  caption?: string;
  /** Sits beside the next half-width block on a wide screen. */
  half?: boolean;
}

export type Block =
  | (BlockBase & { type: "stats"; items: StatItem[] })
  | (BlockBase & { type: "findings"; items: FindingItem[] })
  | (BlockBase & { type: "bars"; unit?: string; max?: number; rows: BarRow[] })
  | (BlockBase & {
      type: "table";
      columns: TableColumn[];
      rows: TableCell[][];
      footnote?: string;
    })
  | (BlockBase & {
      /** One small column chart per series, all on the same scale. */
      type: "columns";
      unit?: string;
      max?: number;
      xLabel?: string;
      x: string[];
      series: Series[];
    })
  | (BlockBase & {
      /** One small line chart per series, all on the same scale. x is numeric. */
      type: "trends";
      unit?: string;
      max?: number;
      xLabel?: string;
      x: number[];
      series: Series[];
    })
  | (BlockBase & {
      type: "compare";
      sides: { label: string; note?: string; stats: StatItem[] }[];
      footnote?: string;
    })
  | (BlockBase & { type: "note"; text: string })
  | (BlockBase & { type: "list"; items: { text: string; status?: StatusChip }[] });

export type BlockType = Block["type"];

export interface Section {
  id: string;
  title: string;
  intro?: string;
  blocks: Block[];
}

export interface View {
  id: string;
  label: string;
  intro?: string;
  sections: Section[];
}

export interface AppAnalyticsReport {
  version: 1;
  /** The day the analysis was run, YYYY-MM-DD. */
  asOf: string;
  /** One sentence on what data the report was built from. */
  sources: string;
  /** How to refresh the report. */
  refresh?: string;
  views: View[];
}

export interface SnapshotMeta {
  id: string;
  as_of: string;
  title: string;
  created_by: string;
  created_at: string;
}

export interface SnapshotRow extends SnapshotMeta {
  payload: AppAnalyticsReport;
}

// ---- Pure helpers --------------------------------------------------------

const MINUS = "−";

/** 1234.5 -> "1,234.5"; keeps the decimals the report gave, never adds any. */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "";
  const abs = Math.abs(v);
  const text = Number.isInteger(abs)
    ? abs.toLocaleString("en-US")
    : abs.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return v < 0 ? `${MINUS}${text}` : text;
}

/** A value with its unit: "%" -> 12.5%, "pts" -> +3 (signed), "" -> 0.25. */
export function formatValue(v: number, unit = ""): string {
  if (!Number.isFinite(v)) return "";
  if (unit === "%") return `${formatNumber(v)}%`;
  if (unit === "pts") return v > 0 ? `+${formatNumber(v)}` : formatNumber(v);
  return unit ? `${formatNumber(v)} ${unit}` : formatNumber(v);
}

/**
 * The scale of a bar column or bar list: always includes zero, so a bar's
 * length is its value. `max` widens the top (a share drawn against 100%).
 */
export function barRange(values: number[], max?: number): { min: number; max: number } {
  const finite = values.filter((v) => Number.isFinite(v));
  const lo = Math.min(0, ...finite);
  let hi = Math.max(0, ...finite);
  if (max != null && Number.isFinite(max) && max > hi) hi = max;
  if (hi === lo) hi = lo + 1;
  return { min: lo, max: hi };
}

/**
 * Where a bar sits on its track, in percent of the track. A negative value
 * grows left from the zero line, a positive one right.
 */
export function barGeometry(
  value: number,
  range: { min: number; max: number },
): { left: number; width: number; zero: number } {
  const span = range.max - range.min;
  const zero = ((0 - range.min) / span) * 100;
  if (!Number.isFinite(value)) return { left: zero, width: 0, zero };
  const clamped = Math.min(range.max, Math.max(range.min, value));
  const width = (Math.abs(clamped) / span) * 100;
  return { left: clamped < 0 ? zero - width : zero, width, zero };
}

/**
 * Points of a small line chart in a 0-100 box: x is spaced by its real values
 * (weeks 1, 2, 4, 8 are not evenly spaced), y is 0 at the bottom.
 */
export function trendPoints(
  x: number[],
  values: number[],
  yMax: number,
): { x: number; y: number }[] {
  const x0 = Math.min(...x);
  const x1 = Math.max(...x);
  const xSpan = x1 - x0 || 1;
  const top = yMax > 0 ? yMax : 1;
  return values.map((v, i) => ({
    x: ((x[i] - x0) / xSpan) * 100,
    y: 100 - (Math.min(top, Math.max(0, v)) / top) * 100,
  }));
}

/** The top of a shared chart scale: the given max, else the largest value. */
export function seriesMax(series: Series[], max?: number): number {
  const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  const hi = Math.max(0, ...all);
  if (max != null && Number.isFinite(max) && max > hi) return max;
  return hi || 1;
}

/** "2026-11-11" -> "Nov 11, 2026", read as a calendar day (no timezone shift). */
export function dateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The view to show: the asked-for one when it exists, else the first. */
export function pickView(report: AppAnalyticsReport, id: string | null | undefined): View | null {
  if (!report.views.length) return null;
  return report.views.find((v) => v.id === id) ?? report.views[0];
}

export function isStatusChip(cell: TableCell): cell is StatusChip {
  return typeof cell === "object" && cell !== null && "status" in cell;
}

/** Text split on `backticks`, so event and table names can be set as code. */
export function inlineParts(text: string): { text: string; code: boolean }[] {
  return text
    .split("`")
    .map((part, i) => ({ text: part, code: i % 2 === 1 }))
    .filter((p) => p.text !== "");
}
