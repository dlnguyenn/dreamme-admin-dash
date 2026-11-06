"use client";

/**
 * Spend tab: every business transaction on Chase, for taxes. Totals by category
 * and year, then what needs checking, then every row. Data comes from
 * /api/finance/ledger. New rows arrive with the daily Chase sync; Chase CSV
 * uploads add history and the fees and credits alerts never cover.
 */
import * as React from "react";
import { Button, useToast } from "./ui";
import { Card, ErrorBanner, InfoWell, Segmented, SectionHeader, thStyle } from "./porcelain";
import {
  ALL_CATEGORIES,
  CATEGORY,
  EXPENSE_CATEGORIES,
  OTHER_CATEGORIES,
  ledgerSummary,
  type LedgerEntry,
  type LedgerSummary,
} from "@/lib/finance/tax-ledger";

const REVIEW_PREVIEW = 15;
const ROWS_PAGE = 100;

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function money(n: number | null): string {
  if (n === null) return "?";
  const s = Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return n < 0 ? `(${s})` : s;
}

const td = (align: "left" | "right" = "right"): React.CSSProperties => ({
  textAlign: align,
  padding: "9px 12px",
  font: "400 13px var(--font-ui)",
  fontVariantNumeric: "tabular-nums",
  borderBottom: "1px solid var(--line)",
  whiteSpace: "nowrap",
  color: "var(--ink-2)",
});

const fieldStyle: React.CSSProperties = {
  font: "400 12.5px var(--font-ui)",
  color: "var(--ink)",
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "5px 8px",
};

export function ExpenseLedgerPanel() {
  const toast = useToast();
  const [rows, setRows] = React.useState<LedgerEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/finance/ledger", { cache: "no-store" });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRows(body.rows);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const res = await fetch("/api/finance/ledger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, text: await file.text() }),
        });
        const body = await res.json();
        toast(body.ok ? `${file.name}: added ${body.added}, ${body.alreadyHere} already here` : body.error);
      }
    } catch (e) {
      toast(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
      load();
    }
  };

  const edit = async (id: string, change: Partial<Pick<LedgerEntry, "category" | "notes" | "review">>) => {
    setRows((prev) => prev?.map((r) => (r.id === id ? { ...r, ...change } : r)) ?? null);
    try {
      const res = await fetch("/api/finance/ledger", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...change }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    } catch (e) {
      toast(`Not saved: ${(e as Error).message}`);
      load();
    }
  };

  return (
    <>
      <SectionHeader
        family="neutral"
        icon="CardOutline"
        title="Expense ledger"
        meta={rows ? `${rows.length.toLocaleString("en-US")} transactions · for taxes` : "for taxes"}
        right={
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".csv"
              multiple
              aria-label="Chase activity CSV files"
              style={{ display: "none" }}
              onChange={(e) => upload(e.target.files)}
            />
            <Button size="sm" variant="secondary" disabled={uploading} onClick={() => fileInput.current?.click()}>
              {uploading ? "Uploading…" : "Upload Chase CSV"}
            </Button>
          </>
        }
      />
      {error && <ErrorBanner>Expense ledger: {error}</ErrorBanner>}
      {!rows && !error && <InfoWell>Loading the expense ledger…</InfoWell>}
      {rows && rows.length === 0 && <InfoWell>No transactions yet. Upload a Chase activity CSV for each business account.</InfoWell>}
      {rows && rows.length > 0 && <LedgerBody rows={rows} edit={edit} />}
    </>
  );
}

type Edit = (id: string, change: Partial<Pick<LedgerEntry, "category" | "notes" | "review">>) => void;

function LedgerBody({ rows, edit }: { rows: LedgerEntry[]; edit: Edit }) {
  const summary = React.useMemo(() => ledgerSummary(rows), [rows]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, width: 0, minWidth: "100%" }}>
      <SummaryTable s={summary} />
      <ReviewList rows={rows} edit={edit} />
      <AllRows rows={rows} years={summary.years} edit={edit} />
      <InfoWell>
        New transactions come from Chase alert emails, at the approved amount. Chase sends no alert for fees, interest or statement
        credits, so upload each account's CSV every quarter and at year end. Rows you edit stay as you left them. To remove a personal
        charge, set it to Personal rather than deleting it. This covers checking 5289, Ink 3314 and card 0352 only: not personal cards,
        Wise or PayPal balances, or gross revenue before store fees. Have a tax professional confirm the categories.
      </InfoWell>
    </div>
  );
}

function SummaryTable({ s }: { s: LedgerSummary }) {
  const line = (label: string, values: Record<string, number> | undefined, bold = false) => (
    <tr key={label}>
      <td style={{ ...td("left"), ...(bold ? { font: "650 13px var(--font-ui)", color: "var(--ink)" } : {}) }}>{label}</td>
      {s.years.map((y) => {
        const v = values?.[y] ?? 0;
        return (
          <td key={y} style={{ ...td(), ...(bold ? { font: "650 13px var(--font-ui)", color: "var(--ink)" } : {}), ...(v === 0 ? { color: "var(--ink-4)" } : {}) }}>
            {v === 0 ? "–" : v < 0 ? `(${usd(-v)})` : usd(v)}
          </td>
        );
      })}
    </tr>
  );
  const heading = (label: string) => (
    <tr key={label}>
      <td colSpan={s.years.length + 1} style={{ ...thStyle("left"), paddingTop: 16 }}>
        {label}
      </td>
    </tr>
  );
  return (
    <Card pad={0} style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle("left")}>Expenses</th>
            {s.years.map((y) => (
              <th key={y} style={thStyle()}>
                {y}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {EXPENSE_CATEGORIES.map((c) => line(c, s.totals[c]))}
          {line(CATEGORY.uncategorized, s.totals[CATEGORY.uncategorized])}
          {line("Total expenses", s.expenses, true)}
          {heading("Not expenses")}
          {OTHER_CATEGORIES.map((c) => line(c, s.totals[c]))}
          {heading("Still open")}
          <tr>
            <td style={td("left")}>Rows to review</td>
            {s.years.map((y) => (
              <td key={y} style={td()}>
                {s.review[y]?.rows ?? "–"}
              </td>
            ))}
          </tr>
          {line("Money out in those rows", Object.fromEntries(s.years.map((y) => [y, s.review[y]?.moneyOut ?? 0])))}
        </tbody>
      </table>
    </Card>
  );
}

function ReviewList({ rows, edit }: { rows: LedgerEntry[]; edit: Edit }) {
  const [showAll, setShowAll] = React.useState(false);
  const open = React.useMemo(() => rows.filter((r) => r.review).sort((a, b) => (a.amount ?? -Infinity) - (b.amount ?? -Infinity)), [rows]);
  if (!open.length) return <InfoWell>Nothing left to review.</InfoWell>;
  return (
    <Card pad={0} style={{ overflowX: "auto" }}>
      <div style={{ padding: "14px 16px 6px", font: "650 13px var(--font-ui)", color: "var(--ink)" }}>Needs review ({open.length}), largest first</div>
      <RowTable rows={showAll ? open : open.slice(0, REVIEW_PREVIEW)} edit={edit} />
      {!showAll && open.length > REVIEW_PREVIEW && (
        <div style={{ padding: 12 }}>
          <Button size="sm" variant="secondary" onClick={() => setShowAll(true)}>
            Show all {open.length}
          </Button>
        </div>
      )}
    </Card>
  );
}

function AllRows({ rows, years, edit }: { rows: LedgerEntry[]; years: string[]; edit: Edit }) {
  const [year, setYear] = React.useState("all");
  const [category, setCategory] = React.useState("all");
  const [search, setSearch] = React.useState("");
  const [limit, setLimit] = React.useState(ROWS_PAGE);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (year === "all" || r.date.startsWith(year)) &&
        (category === "all" || r.category === category) &&
        (!q || r.description.toLowerCase().includes(q) || r.notes.toLowerCase().includes(q)),
    );
  }, [rows, year, category, search]);

  const csvHref = `/api/finance/ledger?format=csv${year === "all" ? "" : `&year=${year}`}`;

  return (
    <Card pad={0} style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "14px 16px 6px" }}>
        <span style={{ font: "650 13px var(--font-ui)", color: "var(--ink)" }}>All transactions ({filtered.length.toLocaleString("en-US")})</span>
        <Segmented size="sm" value={year} onChange={setYear} options={[{ value: "all", label: "All" }, ...years.map((y) => ({ value: y, label: y }))]} />
        <select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)} style={fieldStyle}>
          <option value="all">All categories</option>
          {ALL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input aria-label="Search transactions" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...fieldStyle, width: 160 }} />
        <a href={csvHref} download style={{ marginLeft: "auto", font: "550 12.5px var(--font-ui)", color: "var(--accent)" }}>
          Download CSV ({year === "all" ? "all years" : year})
        </a>
      </div>
      <RowTable rows={filtered.slice(0, limit)} edit={edit} />
      {filtered.length > limit && (
        <div style={{ padding: 12 }}>
          <Button size="sm" variant="secondary" onClick={() => setLimit(limit + ROWS_PAGE)}>
            Show {Math.min(ROWS_PAGE, filtered.length - limit)} more
          </Button>
        </div>
      )}
    </Card>
  );
}

function RowTable({ rows, edit }: { rows: LedgerEntry[]; edit: Edit }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={thStyle("left")}>Date</th>
          <th style={thStyle("left")}>Account</th>
          <th style={thStyle("left")}>Description</th>
          <th style={thStyle()}>Amount</th>
          <th style={thStyle("left")}>Category</th>
          <th style={thStyle("left")}>Notes</th>
          <th style={thStyle("left")} aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <LedgerTableRow key={r.id} row={r} edit={edit} />
        ))}
      </tbody>
    </table>
  );
}

function LedgerTableRow({ row, edit }: { row: LedgerEntry; edit: Edit }) {
  const [notes, setNotes] = React.useState(row.notes);
  React.useEffect(() => setNotes(row.notes), [row.notes]);
  return (
    <tr>
      <td style={td("left")}>{row.date}</td>
      <td style={td("left")} title={row.account}>{row.account.match(/\d{4}$/)?.[0] ?? "?"}</td>
      <td style={{ ...td("left"), whiteSpace: "normal", minWidth: 200, maxWidth: 340 }}>
        <div title={row.description} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink)" }}>
          {row.description}
        </div>
        {row.review && <div style={{ font: "400 12px/1.4 var(--font-ui)", color: "var(--warning-text)", marginTop: 2 }}>{row.review}</div>}
      </td>
      <td style={{ ...td(), color: row.amount !== null && row.amount > 0 ? "var(--success-text)" : "var(--ink)" }}>{money(row.amount)}</td>
      <td style={td("left")}>
        <select aria-label={`Category for ${row.description}`} value={row.category} onChange={(e) => edit(row.id, { category: e.target.value as LedgerEntry["category"] })} style={fieldStyle}>
          {ALL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </td>
      <td style={td("left")}>
        <input
          aria-label={`Notes for ${row.description}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== row.notes) edit(row.id, { notes });
          }}
          style={{ ...fieldStyle, width: 130 }}
        />
      </td>
      <td style={td("left")}>
        {row.review && (
          <Button size="sm" variant="secondary" onClick={() => edit(row.id, { review: "" })}>
            Done
          </Button>
        )}
      </td>
    </tr>
  );
}
