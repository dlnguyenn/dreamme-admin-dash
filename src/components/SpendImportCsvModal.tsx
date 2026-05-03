"use client";

import * as React from "react";
import { Button } from "./ui";

interface ImportResult {
  inserted: number;
  transactionsParsed: number;
  skippedDuplicates: number;
  skippedNonCharges: number;
  parseErrors: string[];
  byVendor: Record<string, number>;
  note?: string;
}

const VENDOR_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  google: "Gemini",
  apify: "Apify",
  vercel: "Vercel",
  supabase: "Supabase",
  business_cc: "Business CC",
  other: "Other",
};

function fmtUSD(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function SpendImportCsvModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [csv, setCsv] = React.useState("");
  const [includeDuplicates, setIncludeDuplicates] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ImportResult | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onFile = async (f: File) => {
    setError(null);
    setResult(null);
    const text = await f.text();
    setCsv(text);
  };

  const submit = async () => {
    if (!csv.trim()) {
      setError("Paste CSV text or upload a Chase statement file");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const res = await fetch("/api/spend/import-csv", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv, includeDuplicates }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setResult({
        inserted: json.inserted ?? 0,
        transactionsParsed: json.transactionsParsed ?? 0,
        skippedDuplicates: json.skippedDuplicates ?? 0,
        skippedNonCharges: json.skippedNonCharges ?? 0,
        parseErrors: json.parseErrors ?? [],
        byVendor: json.byVendor ?? {},
        note: json.note,
      });
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          borderRadius: 14,
          border: "1px solid var(--line)",
          width: "100%",
          maxWidth: 560,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 24,
        }}
      >
        <div
          className="serif"
          style={{
            fontSize: 24,
            fontStyle: "italic",
            marginBottom: 6,
          }}
        >
          Import Chase CSV
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            marginBottom: 18,
            lineHeight: 1.5,
          }}
        >
          Download your Chase business card activity as CSV (Account
          activity → Download). Charges import as Business CC by default.
          Anthropic, Apify, Vercel, Supabase, Gemini are skipped to avoid
          double-counting their API-tracked spend.
        </div>

        <label
          style={{
            display: "block",
            fontSize: 11,
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--ink-3)",
            marginBottom: 6,
          }}
        >
          File
        </label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
          style={{ marginBottom: 14, fontSize: 13 }}
        />

        <label
          style={{
            display: "block",
            fontSize: 11,
            fontFamily: "var(--font-geist-mono), monospace",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--ink-3)",
            marginBottom: 6,
          }}
        >
          Or paste CSV text
        </label>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder="Transaction Date,Post Date,Description,Category,Type,Amount,Memo&#10;..."
          rows={6}
          style={{
            width: "100%",
            padding: 10,
            fontSize: 12,
            fontFamily: "var(--font-geist-mono), monospace",
            border: "1px solid var(--line)",
            borderRadius: 8,
            background: "var(--surface-2)",
            color: "var(--ink)",
            marginBottom: 14,
            resize: "vertical",
          }}
        />

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--ink-2)",
            marginBottom: 18,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={includeDuplicates}
            onChange={(e) => setIncludeDuplicates(e.target.checked)}
          />
          Include API-tracked vendors (will double-count Anthropic, Apify,
          etc.)
        </label>

        {error && (
          <div
            style={{
              padding: 10,
              background:
                "color-mix(in oklab, var(--accent) 10%, var(--surface))",
              border:
                "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--accent)",
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        {result && (
          <div
            style={{
              padding: 14,
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
              borderRadius: 8,
              fontSize: 13,
              marginBottom: 14,
              lineHeight: 1.6,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              Imported {result.inserted} day-vendor row
              {result.inserted === 1 ? "" : "s"} from{" "}
              {result.transactionsParsed} charge
              {result.transactionsParsed === 1 ? "" : "s"}
            </div>
            {Object.keys(result.byVendor).length > 0 && (
              <div style={{ marginBottom: 6 }}>
                {Object.entries(result.byVendor)
                  .sort((a, b) => b[1] - a[1])
                  .map(([v, amt]) => (
                    <div
                      key={v}
                      style={{ display: "flex", justifyContent: "space-between" }}
                    >
                      <span>{VENDOR_LABELS[v] ?? v}</span>
                      <span
                        style={{
                          fontFamily:
                            "var(--font-geist-mono), monospace",
                          fontSize: 12,
                        }}
                      >
                        {fmtUSD(amt)}
                      </span>
                    </div>
                  ))}
              </div>
            )}
            <div style={{ color: "var(--ink-3)", fontSize: 11 }}>
              {result.skippedDuplicates > 0 &&
                `Skipped ${result.skippedDuplicates} API-tracked. `}
              {result.skippedNonCharges > 0 &&
                `Skipped ${result.skippedNonCharges} payment${result.skippedNonCharges === 1 ? "" : "s"}/credit${result.skippedNonCharges === 1 ? "" : "s"}.`}
              {result.note && ` ${result.note}`}
            </div>
            {result.parseErrors.length > 0 && (
              <div
                style={{
                  color: "var(--accent)",
                  fontSize: 11,
                  marginTop: 6,
                }}
              >
                {result.parseErrors.length} parse warning
                {result.parseErrors.length === 1 ? "" : "s"}:{" "}
                {result.parseErrors.slice(0, 3).join("; ")}
              </div>
            )}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <Button onClick={onClose}>{result ? "Close" : "Cancel"}</Button>
          {!result && (
            <Button
              variant="primary"
              onClick={submit}
              disabled={importing}
            >
              {importing ? "Importing…" : "Import"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
