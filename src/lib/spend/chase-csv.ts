/**
 * Chase business credit-card CSV importer.
 *
 * Chase's "Download account activity" CSV uses this header (as of 2025):
 *   Transaction Date,Post Date,Description,Category,Type,Amount,Memo
 *
 * Amount: charges are negative, payments / credits are positive. We only
 * track charges (negative amounts) and flip the sign so the dashboard
 * reads positive USD.
 *
 * Auto-tracked vendors (Anthropic, Google/Gemini, Apify, Vercel,
 * Supabase) are SKIPPED by default. Their per-day USD comes from the
 * vendor APIs; importing the corresponding CC charge would double-count
 * the same spend on the dashboard.
 */

import type { SpendVendor } from "../types";

export interface ParsedTransaction {
  date: string; // YYYY-MM-DD
  description: string;
  amountUsd: number; // positive = a charge (cost to us)
}

export interface CategorizedTransaction extends ParsedTransaction {
  vendor: SpendVendor;
  // True when the charge maps to a vendor we already track via API. The
  // importer skips these by default to avoid double-counting.
  duplicatesApiTracking: boolean;
}

export interface ImportPreview {
  rows: CategorizedTransaction[];
  skippedNonCharges: number;
  parseErrors: string[];
}

const REQUIRED_HEADERS = [
  "Transaction Date",
  "Description",
  "Amount",
] as const;

/**
 * RFC-4180-ish CSV parser. Handles double-quoted fields with embedded
 * commas / escaped quotes (Chase descriptions sometimes contain both).
 * Returns rows as string arrays; downstream code maps to typed shape.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const stripped = text.replace(/^﻿/, "");
  while (i < stripped.length) {
    const c = stripped[i];
    if (inQuotes) {
      if (c === '"') {
        if (stripped[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      row.push(field);
      field = "";
      // Skip empty trailing rows
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      // Consume \r\n as a single break
      if (c === "\r" && stripped[i + 1] === "\n") i++;
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

function normalizeDate(raw: string): string | null {
  // Chase exports use M/D/YYYY (or MM/DD/YYYY). Accept either.
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, "0");
    const dd = m[2].padStart(2, "0");
    return `${m[3]}-${mm}-${dd}`;
  }
  // Some users may export as YYYY-MM-DD already.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
  return null;
}

const AUTO_TRACKED_VENDORS: SpendVendor[] = [
  "anthropic",
  "google",
  "apify",
  "vercel",
  "supabase",
];

/**
 * Maps a Chase merchant description to a SpendVendor. Patterns are
 * deliberately permissive — Chase prepends "TST*", "SQ *", phone
 * numbers, etc., so we match on substrings.
 */
export function categorizeMerchant(description: string): SpendVendor {
  const d = description.toUpperCase();
  if (d.includes("ANTHROPIC")) return "anthropic";
  if (d.includes("APIFY")) return "apify";
  if (d.includes("VERCEL")) return "vercel";
  if (d.includes("SUPABASE")) return "supabase";
  if (
    d.includes("GEMINI") ||
    d.includes("GOOGLE *AI") ||
    d.includes("GOOGLE AI") ||
    d.includes("GOOGLE *CLOUD") ||
    d.includes("GOOGLE CLOUD")
  )
    return "google";
  return "business_cc";
}

export function parseChaseCsv(text: string): ImportPreview {
  const rows = parseCsv(text);
  if (!rows.length) {
    return { rows: [], skippedNonCharges: 0, parseErrors: ["empty file"] };
  }
  const header = rows[0].map((h) => h.trim());
  const missing = REQUIRED_HEADERS.filter((h) => !header.includes(h));
  if (missing.length) {
    return {
      rows: [],
      skippedNonCharges: 0,
      parseErrors: [
        `missing expected columns: ${missing.join(", ")}. Got: ${header.join(", ")}`,
      ],
    };
  }

  const dateIdx = header.indexOf("Transaction Date");
  const descIdx = header.indexOf("Description");
  const amountIdx = header.indexOf("Amount");

  const out: CategorizedTransaction[] = [];
  const errors: string[] = [];
  let skippedNonCharges = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.length || r.every((c) => !c.trim())) continue;
    const dateRaw = r[dateIdx] ?? "";
    const desc = (r[descIdx] ?? "").trim();
    const amountRaw = (r[amountIdx] ?? "").trim().replace(/[$,]/g, "");
    const date = normalizeDate(dateRaw);
    const amount = Number(amountRaw);

    if (!date) {
      errors.push(`row ${i + 1}: bad date "${dateRaw}"`);
      continue;
    }
    if (!Number.isFinite(amount)) {
      errors.push(`row ${i + 1}: bad amount "${amountRaw}"`);
      continue;
    }
    if (amount >= 0) {
      // Payments to the card and credits — not spend.
      skippedNonCharges++;
      continue;
    }

    const vendor = categorizeMerchant(desc);
    out.push({
      date,
      description: desc,
      amountUsd: Math.round(-amount * 100) / 100,
      vendor,
      duplicatesApiTracking: AUTO_TRACKED_VENDORS.includes(vendor),
    });
  }

  return { rows: out, skippedNonCharges, parseErrors: errors };
}
