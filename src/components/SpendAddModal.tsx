"use client";

import * as React from "react";
import { Button } from "./ui";
import type { SpendCategory, SpendVendor } from "@/lib/types";

const VENDOR_OPTIONS: Array<{
  id: SpendVendor;
  label: string;
  category: SpendCategory;
}> = [
  { id: "anthropic", label: "Anthropic", category: "ai" },
  { id: "google", label: "Google / Gemini", category: "ai" },
  { id: "apify", label: "Apify", category: "ai" },
  { id: "vercel", label: "Vercel", category: "ai" },
  { id: "supabase", label: "Supabase", category: "ai" },
  { id: "business_cc", label: "Business Credit Card", category: "business" },
  { id: "other", label: "Other", category: "business" },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthISO(): string {
  const d = new Date();
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

export function SpendAddModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [vendor, setVendor] = React.useState<SpendVendor>("vercel");
  const [amount, setAmount] = React.useState("");
  const [periodStart, setPeriodStart] = React.useState(firstOfMonthISO());
  const [periodEnd, setPeriodEnd] = React.useState(todayISO());
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const vendorOpt = VENDOR_OPTIONS.find((v) => v.id === vendor)!;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      setError("Amount must be a non-negative number");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/spend/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vendor,
          category: vendorOpt.category,
          amount_usd: amt,
          period_start: periodStart,
          period_end: periodEnd,
          note: note.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "color-mix(in oklab, var(--ink) 40%, transparent)",
          backdropFilter: "blur(2px)",
          zIndex: 200,
          animation: "fadeIn 160ms ease",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 201,
          width: "92vw",
          maxWidth: 460,
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 16,
          boxShadow: "var(--shadow-lg)",
          padding: "24px 24px 20px",
          animation: "fadeIn 180ms ease",
        }}
      >
        <div
          className="serif"
          style={{
            fontSize: 22,
            fontWeight: 400,
            fontStyle: "italic",
            marginBottom: 4,
            letterSpacing: "-0.01em",
          }}
        >
          Add expense
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-3)",
            marginBottom: 18,
          }}
        >
          Manual entry — use this for anything the API adapters don&apos;t cover.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Vendor">
            <select
              value={vendor}
              onChange={(e) => setVendor(e.target.value as SpendVendor)}
              style={inputStyle}
            >
              {VENDOR_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} · {v.category}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount (USD)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              style={inputStyle}
            />
          </Field>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <Field label="Period start">
                <input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  style={inputStyle}
                />
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="Period end">
                <input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  style={inputStyle}
                />
              </Field>
            </div>
          </div>
          <Field label="Note (optional)">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Invoice #1234"
              style={inputStyle}
            />
          </Field>
        </div>

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 10px",
              fontSize: 12,
              color: "var(--accent)",
              background:
                "color-mix(in oklab, var(--accent) 10%, var(--surface))",
              border:
                "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))",
              borderRadius: 8,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 18,
          }}
        >
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save expense"}
          </Button>
        </div>
      </div>
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  fontSize: 13,
  fontFamily: "inherit",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--surface)",
  color: "var(--ink)",
  outline: "none",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          fontFamily: "var(--font-geist-mono), monospace",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--ink-3)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
