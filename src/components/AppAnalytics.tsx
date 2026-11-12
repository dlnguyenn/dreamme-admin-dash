"use client";

/**
 * App Analytics tab: the product-analytics report. How people use the app,
 * what keeps them paying, why they cancel, what to look at next, and how far
 * each event can be trusted.
 *
 * It shows one dated report, read from /api/app-analytics. A report is views >
 * sections > blocks; this file draws each block type. The figures come from
 * the database and are never written here (this repo is public). Shapes and
 * rules: src/lib/app-analytics.ts.
 *
 * Deep link: ?tab=app-analytics&view=<view id>.
 */
import * as React from "react";
import { PageHeader } from "./Shell";
import { Button } from "./ui";
import { Icons } from "./Icons";
import { Card, ErrorBanner, InfoWell, Segmented } from "./porcelain";
import { useIsMobile } from "@/lib/useIsMobile";
import {
  EVIDENCE_HINTS,
  EVIDENCE_LABELS,
  barGeometry,
  barRange,
  dateLabel,
  formatValue,
  inlineParts,
  isStatusChip,
  pickView,
  seriesMax,
  trendPoints,
  type AppAnalyticsReport,
  type Block,
  type Evidence,
  type Section,
  type SnapshotMeta,
  type SnapshotRow,
  type StatItem,
  type StatusChip,
  type TableCell,
  type TableColumn,
  type Tone,
} from "@/lib/app-analytics";

const VIEW_KEY = "dad.appAnalytics.view.v1";

type Loaded = { snapshot: SnapshotRow | null; history: SnapshotMeta[] };

const TONE_FAMILY: Record<Tone, string> = {
  good: "success",
  warn: "warning",
  bad: "danger",
  info: "info",
  neutral: "neutral",
};

const EVIDENCE_TONE: Record<Evidence, Tone> = {
  measured: "good",
  correlational: "warn",
  guess: "neutral",
};

const text = {
  body: { font: "400 13.5px/1.6 var(--font-ui)", color: "var(--ink-2)" } as React.CSSProperties,
  small: { font: "400 12.5px/1.5 var(--font-ui)", color: "var(--ink-3)" } as React.CSSProperties,
};

export function AppAnalytics() {
  const isMobile = useIsMobile();
  const [data, setData] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [viewId, setViewId] = React.useState<string | null>(null);

  const load = React.useCallback(async (id?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/app-analytics${id ? `?id=${encodeURIComponent(id)}` : ""}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData({ snapshot: json.snapshot ?? null, history: json.history ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("view");
      setViewId(fromUrl ?? localStorage.getItem(VIEW_KEY));
    } catch {}
  }, [load]);

  const report = data?.snapshot?.payload ?? null;
  const view = report ? pickView(report, viewId) : null;

  const pick = (id: string) => {
    setViewId(id);
    try {
      localStorage.setItem(VIEW_KEY, id);
      const url = new URL(window.location.href);
      url.searchParams.set("view", id);
      window.history.replaceState(null, "", url.toString());
    } catch {}
  };

  return (
    <div style={{ maxWidth: 1120 }}>
      <PageHeader
        title="App Analytics"
        subtitle="How people use the app, what keeps them paying and why they cancel, worked out from the raw event data."
        actions={
          report && report.views.length > 1 ? (
            // Six views don't fit a phone: the switcher scrolls instead of clipping.
            <div className="mobile-hscroll" style={{ maxWidth: "100%", overflowX: "auto" }}>
              <Segmented
                value={view?.id ?? ""}
                onChange={pick}
                options={report.views.map((v) => ({ value: v.id, label: v.label }))}
              />
            </div>
          ) : undefined
        }
      />

      {error && (
        <ErrorBanner>
          <span style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 260px" }}>Couldn&apos;t load the report: {error}</span>
            <Button size="sm" variant="secondary" icon={<Icons.Refresh />} onClick={() => void load(data?.snapshot?.id)}>
              Try again
            </Button>
          </span>
        </ErrorBanner>
      )}

      {!data && loading && <LoadingBlocks />}

      {data && !data.snapshot && !error && <EmptyState />}

      {data?.snapshot && report && view && (
        <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity 160ms ease" }}>
          <SnapshotLine
            snapshot={data.snapshot}
            history={data.history}
            report={report}
            onPick={(id) => void load(id)}
          />
          {view.intro && (
            <p style={{ ...text.body, fontSize: 14, maxWidth: "74ch", margin: "0 0 4px" }}>
              <Inline text={view.intro} />
            </p>
          )}
          {view.sections.map((s, i) => (
            <SectionView key={s.id} section={s} first={i === 0 && !view.intro} isMobile={isMobile} />
          ))}
          {report.refresh && (
            <p style={{ ...text.small, maxWidth: "80ch", margin: "44px 0 0" }}>
              <Inline text={report.refresh} />
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Page furniture ------------------------------------------------------

function SnapshotLine({
  snapshot,
  history,
  report,
  onPick,
}: {
  snapshot: SnapshotRow;
  history: SnapshotMeta[];
  report: AppAnalyticsReport;
  onPick: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "6px 14px",
        flexWrap: "wrap",
        margin: "-8px 0 22px",
        ...text.small,
      }}
    >
      <span style={{ maxWidth: "88ch" }}>
        <span style={{ color: "var(--ink)", fontWeight: 600 }}>Snapshot of {dateLabel(report.asOf)}.</span>{" "}
        <Inline text={report.sources} />
      </span>
      {history.length > 1 && (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span>Report</span>
          <select
            value={snapshot.id}
            onChange={(e) => onPick(e.target.value)}
            style={{
              font: "500 12.5px var(--font-ui)",
              color: "var(--ink)",
              background: "var(--surface)",
              border: "1px solid var(--line-2)",
              borderRadius: 9,
              padding: "5px 8px",
            }}
          >
            {history.map((h) => (
              <option key={h.id} value={h.id}>
                {dateLabel(h.as_of)}
                {h.title ? `, ${h.title}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function LoadingBlocks() {
  return (
    <div aria-busy="true" aria-label="Loading the report" style={{ display: "grid", gap: 14 }}>
      {[96, 260, 180].map((h, i) => (
        <div key={i} style={{ height: h, borderRadius: 16, background: "var(--bg-2)", opacity: 0.6 }} />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <InfoWell style={{ maxWidth: 640 }}>
      <strong style={{ color: "var(--ink)", fontWeight: 650 }}>No report has been stored yet.</strong>{" "}
      A Claude session adds one after running the analysis, by posting it to{" "}
      <Code>/api/app-analytics</Code>. The newest report shows here, and older ones stay in a
      list so a past run can be opened.
    </InfoWell>
  );
}

function SectionView({ section, first, isMobile }: { section: Section; first: boolean; isMobile: boolean }) {
  return (
    <section style={{ marginTop: first ? 4 : 40 }}>
      <h2 style={{ font: "650 19px/1.25 var(--font-ui)", color: "var(--ink)", margin: "0 0 6px" }}>
        {section.title}
      </h2>
      {section.intro && (
        <p style={{ ...text.body, maxWidth: "74ch", margin: 0 }}>
          <Inline text={section.intro} />
        </p>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
          gap: 14,
          marginTop: 14,
          alignItems: "start",
        }}
      >
        {section.blocks.map((b, i) => (
          <div key={i} style={{ gridColumn: b.half && !isMobile ? "span 1" : "1 / -1", minWidth: 0 }}>
            <BlockView block={b} isMobile={isMobile} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- Small shared pieces -------------------------------------------------

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        font: "500 0.92em var(--font-mono)",
        background: "var(--surface-2)",
        border: "1px solid var(--line)",
        borderRadius: 5,
        padding: "0 4px",
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </code>
  );
}

/** Text with `backticked` names set as code. */
function Inline({ text: value }: { text: string }) {
  return (
    <>
      {inlineParts(value).map((p, i) => (p.code ? <Code key={i}>{p.text}</Code> : <React.Fragment key={i}>{p.text}</React.Fragment>))}
    </>
  );
}

/** A coloured dot and a label: the label carries the meaning, the dot is extra. */
function StatusText({ chip, hint }: { chip: StatusChip; hint?: string }) {
  const family = TONE_FAMILY[chip.tone];
  return (
    <span
      title={hint}
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 6,
        font: "600 12.5px/1.4 var(--font-ui)",
        color: `var(--${family}-text)`,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: `var(--${family})`,
          flex: "none",
          transform: "translateY(-1px)",
        }}
      />
      {chip.status}
    </span>
  );
}

/** The header of a block that has a title: the title, then what the figures cover. */
function Frame({
  block,
  flush,
  children,
}: {
  block: Block;
  /** The body runs edge to edge (tables). */
  flush?: boolean;
  children: React.ReactNode;
}) {
  const hasHead = !!(block.title || block.caption);
  return (
    <Card pad={0} style={{ minWidth: 0, overflow: "hidden" }}>
      {hasHead && (
        <div style={{ padding: "16px 20px 0" }}>
          {block.title && (
            <h3 style={{ font: "650 14.5px/1.35 var(--font-ui)", color: "var(--ink)", margin: 0 }}>
              {block.title}
            </h3>
          )}
          {block.caption && (
            <p style={{ ...text.small, maxWidth: "84ch", margin: block.title ? "4px 0 0" : 0 }}>
              <Inline text={block.caption} />
            </p>
          )}
        </div>
      )}
      <div style={{ padding: flush ? (hasHead ? "12px 0 0" : 0) : hasHead ? "14px 20px 18px" : "16px 20px 18px" }}>
        {children}
      </div>
    </Card>
  );
}

function Footnote({ children, inset }: { children: string; inset?: boolean }) {
  return (
    <div
      style={{
        padding: inset ? "12px 20px 16px" : "14px 0 0",
        borderTop: inset ? "1px solid var(--line)" : "none",
      }}
    >
      <p style={{ ...text.small, color: "var(--ink-2)", maxWidth: "84ch", margin: 0 }}>
        <Inline text={children} />
      </p>
    </div>
  );
}

/** A bar on its track. Positive values grow right from zero, negative ones left. */
function Bar({
  value,
  range,
  quiet,
  label,
}: {
  value: number;
  range: { min: number; max: number };
  quiet?: boolean;
  label: string;
}) {
  const g = barGeometry(value, range);
  const negative = value < 0;
  const diverging = range.min < 0;
  return (
    <span
      title={label}
      style={{
        position: "relative",
        display: "block",
        height: 8,
        borderRadius: 4,
        // --line, not --bg-2: in dark mode --bg-2 is darker than the card and the track disappears.
        background: "var(--line)",
        minWidth: 56,
        flex: 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${g.left}%`,
          width: `${g.width}%`,
          background: negative ? "var(--cat-3)" : quiet ? "var(--ink-4)" : "var(--chart-bar)",
          // Rounded at the data end, square where it meets the baseline.
          borderRadius: negative ? "4px 0 0 4px" : diverging ? "0 4px 4px 0" : 4,
        }}
      />
      {diverging && (
        <span
          aria-hidden
          style={{ position: "absolute", top: -3, bottom: -3, left: `${g.zero}%`, width: 1, background: "var(--ink-3)" }}
        />
      )}
    </span>
  );
}

// ---- Blocks --------------------------------------------------------------

function BlockView({ block, isMobile }: { block: Block; isMobile: boolean }) {
  switch (block.type) {
    case "stats":
      return <StatsBlock items={block.items} />;
    case "findings":
      return <FindingsBlock block={block} />;
    case "bars":
      return <BarsBlock block={block} isMobile={isMobile} />;
    case "table":
      return <TableBlock block={block} />;
    case "columns":
      return <ColumnsBlock block={block} />;
    case "trends":
      return <TrendsBlock block={block} />;
    case "compare":
      return <CompareBlock block={block} isMobile={isMobile} />;
    case "note":
      return (
        <InfoWell style={{ font: "400 13.5px/1.6 var(--font-ui)", color: "var(--ink-2)", padding: "14px 18px" }}>
          {block.title && <strong style={{ color: "var(--ink)", fontWeight: 650 }}>{block.title} </strong>}
          <Inline text={block.text} />
        </InfoWell>
      );
    case "list":
      return <ListBlock block={block} />;
  }
}

/** Headline numbers in one card. Each cell draws its own top and left hairline, so a wrapped row still divides cleanly. */
function StatsBlock({ items }: { items: StatItem[] }) {
  // One row when every cell gets 190px; otherwise an even grid (two across, or
  // one for an odd count), never a row with a single cell left over.
  const fits = items.length * 190;
  const fallback = items.length % 2 === 0 ? "50%" : "100%";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(clamp(190px, calc((${fits}px - 100%) * 999), ${fallback}), 1fr))`,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 16,
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
      }}
    >
      {items.map((s, i) => (
        <div
          key={i}
          style={{
            // Label, figure and note share rows across the cells, so the
            // figures line up even when one label wraps and its neighbour doesn't.
            display: "grid",
            gridTemplateRows: "subgrid",
            gridRow: "span 3",
            padding: "16px 18px 17px",
            boxShadow: "-1px 0 0 var(--line), 0 -1px 0 var(--line)",
            minWidth: 0,
          }}
        >
          <div style={{ font: "500 12.5px/1.35 var(--font-ui)", color: "var(--ink-3)" }}>{s.label}</div>
          <div style={{ font: "700 28px/1.1 var(--font-ui)", color: "var(--ink)", margin: "6px 0 5px" }}>{s.value}</div>
          <div style={{ font: "400 12.5px/1.45 var(--font-ui)", color: "var(--ink-2)" }}>{s.note}</div>
        </div>
      ))}
    </div>
  );
}

function FindingsBlock({ block }: { block: Extract<Block, { type: "findings" }> }) {
  return (
    <Frame block={block} flush>
      {block.items.map((f, i) => (
        <div
          key={i}
          style={{
            padding: "15px 20px 16px",
            borderTop: i || block.title || block.caption ? "1px solid var(--line)" : "none",
          }}
        >
          <h3
            style={{
              font: "650 15px/1.4 var(--font-ui)",
              color: "var(--ink)",
              margin: 0,
              maxWidth: "70ch",
              textWrap: "balance",
            }}
          >
            {f.title}
          </h3>
          {f.body && (
            <p style={{ ...text.body, maxWidth: "76ch", margin: "4px 0 0" }}>
              <Inline text={f.body} />
            </p>
          )}
          {(f.evidence || f.status) && (
            <div style={{ display: "flex", gap: "4px 18px", flexWrap: "wrap", marginTop: 8 }}>
              {f.evidence && (
                <StatusText
                  chip={{ status: EVIDENCE_LABELS[f.evidence], tone: EVIDENCE_TONE[f.evidence] }}
                  hint={EVIDENCE_HINTS[f.evidence]}
                />
              )}
              {f.status && <StatusText chip={f.status} />}
            </div>
          )}
        </div>
      ))}
    </Frame>
  );
}

function BarsBlock({ block, isMobile }: { block: Extract<Block, { type: "bars" }>; isMobile: boolean }) {
  const range = barRange(
    block.rows.map((r) => r.value),
    block.max,
  );
  const anyEmphasis = block.rows.some((r) => r.emphasis);
  return (
    <Frame block={block}>
      <div style={{ display: "grid", gap: isMobile ? 12 : 9 }}>
        {block.rows.map((r, i) => {
          const value = formatValue(r.value, block.unit);
          const label = (
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  font: `${r.emphasis ? 650 : 500} 13.5px/1.35 var(--font-ui)`,
                  color: "var(--ink)",
                }}
              >
                {r.label}
              </div>
              {r.note && <div style={{ ...text.small, fontSize: 12 }}>{r.note}</div>}
            </div>
          );
          const figure = (
            <span
              style={{
                font: "650 13.5px var(--font-ui)",
                fontVariantNumeric: "tabular-nums",
                color: "var(--ink)",
                textAlign: "right",
                minWidth: 52,
              }}
            >
              {value}
            </span>
          );
          const bar = (
            <Bar value={r.value} range={range} quiet={anyEmphasis && !r.emphasis} label={`${r.label}: ${value}`} />
          );
          // On a narrow screen the bar drops under its name.
          return isMobile ? (
            <div key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                {label}
                {figure}
              </div>
              <div style={{ display: "flex" }}>{bar}</div>
            </div>
          ) : (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(150px, 260px) minmax(0, 1fr) auto",
                alignItems: "center",
                gap: 14,
              }}
            >
              {label}
              <div style={{ display: "flex" }}>{bar}</div>
              {figure}
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

const COLUMN_MIN: Record<NonNullable<TableColumn["kind"]>, number> = {
  text: 190,
  num: 92,
  bar: 168,
  status: 150,
};

function TableBlock({ block }: { block: Extract<Block, { type: "table" }> }) {
  const kinds = block.columns.map((c) => c.kind ?? "text");
  const ranges = block.columns.map((c, ci) =>
    kinds[ci] === "bar"
      ? barRange(
          block.rows.map((r) => r[ci]).filter((v): v is number => typeof v === "number"),
          c.max,
        )
      : null,
  );
  const minWidth = kinds.reduce((sum, k, i) => sum + (i === 0 && k === "text" ? 170 : COLUMN_MIN[k]), 0);

  const cell = (value: TableCell, ci: number, rowLabel: string) => {
    const col = block.columns[ci];
    const kind = kinds[ci];
    if (value === null || value === "") return <span style={{ color: "var(--ink-4)" }} aria-label="none" />;
    if (isStatusChip(value)) return <StatusText chip={value} />;
    if (typeof value === "number") {
      const shown = formatValue(value, col.unit);
      if (kind === "bar" && ranges[ci]) {
        return (
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 50, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, flex: "none" }}>
              {shown}
            </span>
            <Bar value={value} range={ranges[ci]} label={`${rowLabel}, ${col.label}: ${shown}`} />
          </span>
        );
      }
      return <span style={{ fontVariantNumeric: "tabular-nums" }}>{shown}</span>;
    }
    return <Inline text={value} />;
  };

  return (
    <Frame block={block} flush>
      {/* contain keeps a wide table from stretching the page; it scrolls inside the card. */}
      <div style={{ overflowX: "auto", contain: "inline-size" }}>
        <table style={{ width: "100%", minWidth, borderCollapse: "collapse", font: "400 13.5px/1.45 var(--font-ui)" }}>
          <thead>
            <tr>
              {block.columns.map((c, ci) => (
                <th
                  key={ci}
                  scope="col"
                  style={{
                    textAlign: kinds[ci] === "num" ? "right" : "left",
                    padding: "9px 20px 9px 0",
                    paddingLeft: ci === 0 ? 20 : 0,
                    font: "600 12px/1.35 var(--font-ui)",
                    color: "var(--ink-3)",
                    borderBottom: "1px solid var(--line)",
                    verticalAlign: "bottom",
                  }}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, ri) => {
              const rowLabel = typeof row[0] === "string" ? row[0].replace(/`/g, "") : `Row ${ri + 1}`;
              return (
                <tr key={ri}>
                  {row.map((value, ci) => {
                    const Tag = ci === 0 ? "th" : "td";
                    return (
                      <Tag
                        key={ci}
                        {...(ci === 0 ? { scope: "row" as const } : {})}
                        style={{
                          textAlign: kinds[ci] === "num" ? "right" : "left",
                          padding: "11px 20px 11px 0",
                          paddingLeft: ci === 0 ? 20 : 0,
                          borderTop: ri ? "1px solid var(--line)" : "none",
                          verticalAlign: "top",
                          font: "inherit",
                          fontWeight: ci === 0 ? 600 : 400,
                          color: ci === 0 || kinds[ci] !== "text" ? "var(--ink)" : "var(--ink-2)",
                          minWidth: kinds[ci] === "text" && ci > 0 ? 200 : undefined,
                          maxWidth: kinds[ci] === "text" ? 460 : undefined,
                        }}
                      >
                        {cell(value, ci, rowLabel)}
                      </Tag>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {block.footnote && <Footnote inset>{block.footnote}</Footnote>}
    </Frame>
  );
}

/** The exact figures behind a chart, for anyone who wants the numbers rather than the shape. */
function NumbersTable({
  xLabel,
  x,
  series,
  unit,
}: {
  xLabel: string;
  x: (string | number)[];
  series: { label: string; values: number[] }[];
  unit?: string;
}) {
  const cellStyle: React.CSSProperties = {
    padding: "6px 14px 6px 0",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    borderTop: "1px solid var(--line)",
  };
  return (
    <details style={{ marginTop: 16 }}>
      <summary
        style={{ font: "600 12.5px var(--font-ui)", color: "var(--link)", cursor: "pointer", width: "fit-content" }}
      >
        Show the numbers
      </summary>
      <div style={{ overflowX: "auto", contain: "inline-size", marginTop: 8 }}>
        <table style={{ borderCollapse: "collapse", font: "400 12.5px/1.4 var(--font-ui)", color: "var(--ink)" }}>
          <thead>
            <tr>
              <th scope="col" style={{ ...cellStyle, textAlign: "left", borderTop: "none", fontWeight: 600, color: "var(--ink-3)" }}>
                {xLabel}
              </th>
              {x.map((v, i) => (
                <th key={i} scope="col" style={{ ...cellStyle, borderTop: "none", fontWeight: 600, color: "var(--ink-3)" }}>
                  {v}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.map((s, si) => (
              <tr key={si}>
                <th scope="row" style={{ ...cellStyle, textAlign: "left", fontWeight: 500, whiteSpace: "nowrap" }}>
                  {s.label}
                </th>
                {s.values.map((v, i) => (
                  <td key={i} style={cellStyle}>
                    {formatValue(v, unit)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const PLOT_H = 112;

function ColumnsBlock({ block }: { block: Extract<Block, { type: "columns" }> }) {
  const yMax = seriesMax(block.series, block.max);
  return (
    <Frame block={block}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "26px 32px" }}>
        {block.series.map((s, si) => (
          <figure key={si} style={{ margin: 0, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <figcaption style={{ font: "600 13px/1.35 var(--font-ui)", color: "var(--ink)", marginBottom: 12, flex: 1 }}>
              {s.label}
            </figcaption>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${block.x.length}, minmax(0, 1fr))`,
                alignItems: "end",
                height: PLOT_H + 20,
                borderBottom: "1px solid var(--line-2)",
              }}
            >
              {s.values.map((v, i) => {
                const shown = formatValue(v, block.unit);
                return (
                  <div
                    key={i}
                    title={`${block.xLabel ? `${block.xLabel} ` : ""}${block.x[i]}: ${shown}`}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
                  >
                    <span style={{ font: "600 11.5px/1 var(--font-ui)", fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>
                      {shown}
                    </span>
                    <span
                      style={{
                        width: "min(24px, 62%)",
                        height: Math.max(1, (Math.max(0, v) / yMax) * PLOT_H),
                        background: "var(--chart-bar)",
                        borderRadius: "4px 4px 0 0",
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div
              aria-hidden
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${block.x.length}, minmax(0, 1fr))`,
                marginTop: 6,
                font: "500 11.5px/1 var(--font-ui)",
                fontVariantNumeric: "tabular-nums",
                color: "var(--ink-3)",
                textAlign: "center",
              }}
            >
              {block.x.map((label, i) => (
                <span key={i}>{label}</span>
              ))}
            </div>
            {block.xLabel && (
              <div style={{ ...text.small, fontSize: 12, textAlign: "center", marginTop: 6 }}>{block.xLabel}</div>
            )}
          </figure>
        ))}
      </div>
      <NumbersTable xLabel={block.xLabel ?? ""} x={block.x} series={block.series} unit={block.unit} />
    </Frame>
  );
}

function TrendsBlock({ block }: { block: Extract<Block, { type: "trends" }> }) {
  const yMax = seriesMax(block.series, block.max);
  const xName = block.xLabel ?? "";
  const first = block.x[0];
  const last = block.x[block.x.length - 1];
  return (
    <Frame block={block}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "26px 34px" }}>
        {block.series.map((s, si) => {
          const pts = trendPoints(block.x, s.values, yMax);
          const line = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
          const end = { font: "650 17px/1 var(--font-ui)", color: "var(--ink)" } as React.CSSProperties;
          return (
            <figure key={si} style={{ margin: 0, minWidth: 0 }}>
              <figcaption style={{ font: "600 13px/1.35 var(--font-ui)", color: "var(--ink)" }}>{s.label}</figcaption>
              <div style={{ display: "flex", justifyContent: "space-between", margin: "8px 0 10px" }}>
                <span style={end}>{formatValue(s.values[0], block.unit)}</span>
                <span style={end}>{formatValue(s.values[s.values.length - 1], block.unit)}</span>
              </div>
              {/* The dots are HTML so they stay round; the line stretches with the box. */}
              <div style={{ position: "relative", height: 58, margin: "0 5px", borderBottom: "1px solid var(--line-2)" }}>
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
                >
                  <polygon points={`0,100 ${line} 100,100`} fill="var(--chart-line)" opacity={0.07} />
                  <polyline
                    points={line}
                    fill="none"
                    stroke="var(--chart-line)"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                {pts.map((p, i) => (
                  <span
                    key={i}
                    title={`${xName} ${block.x[i]}: ${formatValue(s.values[i], block.unit)}`.trim()}
                    style={{
                      position: "absolute",
                      left: `${p.x}%`,
                      top: `${p.y}%`,
                      width: 20,
                      height: 20,
                      transform: "translate(-50%, -50%)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 999,
                        background: "var(--chart-line)",
                        boxShadow: "0 0 0 2px var(--surface)",
                      }}
                    />
                  </span>
                ))}
              </div>
              <div
                aria-hidden
                style={{ display: "flex", justifyContent: "space-between", marginTop: 6, ...text.small, fontSize: 12 }}
              >
                <span>
                  {xName} {first}
                </span>
                <span>
                  {xName} {last}
                </span>
              </div>
            </figure>
          );
        })}
      </div>
      <NumbersTable xLabel={xName} x={block.x} series={block.series} unit={block.unit} />
    </Frame>
  );
}

function CompareBlock({ block, isMobile }: { block: Extract<Block, { type: "compare" }>; isMobile: boolean }) {
  return (
    <Frame block={block}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "minmax(0, 1fr)" : `repeat(${block.sides.length}, minmax(0, 1fr))`,
        }}
      >
        {block.sides.map((side, i) => (
          <div
            key={i}
            style={
              isMobile
                ? { padding: i ? "14px 0 0" : 0, marginTop: i ? 14 : 0, borderTop: i ? "1px solid var(--line)" : "none" }
                : { padding: i ? "0 0 0 24px" : "0 24px 0 0", borderLeft: i ? "1px solid var(--line)" : "none" }
            }
          >
            <div style={{ font: "650 13.5px/1.35 var(--font-ui)", color: "var(--ink)" }}>{side.label}</div>
            {side.note && <div style={{ ...text.small, fontSize: 12, marginTop: 2 }}>{side.note}</div>}
            <dl style={{ margin: "10px 0 0", display: "grid", gap: 8 }}>
              {side.stats.map((s, si) => (
                <div key={si} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <dt style={{ font: "400 13px/1.4 var(--font-ui)", color: "var(--ink-2)" }}>{s.label}</dt>
                  <dd style={{ margin: 0, textAlign: "right" }}>
                    <span style={{ font: "650 15px/1.2 var(--font-ui)", fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>
                      {s.value}
                    </span>
                    {s.note && <span style={{ display: "block", ...text.small, fontSize: 12 }}>{s.note}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      {block.footnote && <Footnote>{block.footnote}</Footnote>}
    </Frame>
  );
}

function ListBlock({ block }: { block: Extract<Block, { type: "list" }> }) {
  return (
    <Frame block={block}>
      <ul style={{ margin: 0, padding: "0 0 0 18px", display: "grid", gap: 8 }}>
        {block.items.map((item, i) => (
          <li key={i} style={{ ...text.body, maxWidth: "84ch", paddingLeft: 2 }}>
            <Inline text={item.text} />
            {item.status && (
              <span style={{ marginLeft: 10, whiteSpace: "nowrap" }}>
                <StatusText chip={item.status} />
              </span>
            )}
          </li>
        ))}
      </ul>
    </Frame>
  );
}
