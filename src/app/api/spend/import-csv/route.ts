import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  parseChaseCsv,
  type CategorizedTransaction,
} from "@/lib/spend/chase-csv";
import type { SpendVendor } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const VENDOR_CATEGORY: Record<SpendVendor, "ai" | "business"> = {
  anthropic: "ai",
  google: "ai",
  apify: "ai",
  vercel: "ai",
  supabase: "ai",
  business_cc: "business",
  other: "business",
};

interface AggregatedRow {
  vendor: SpendVendor;
  period_start: string;
  period_end: string;
  amount_usd: number;
  category: "ai" | "business";
  source: "csv";
  metadata: { transactions: Array<{ description: string; amount: number }> };
}

/**
 * Aggregate per (date, vendor) so re-importing the same statement is
 * idempotent against the unique constraint
 * (vendor, period_start, period_end, source).
 */
function aggregate(
  rows: CategorizedTransaction[],
  includeDuplicates: boolean,
): AggregatedRow[] {
  const map = new Map<string, AggregatedRow>();
  for (const r of rows) {
    if (!includeDuplicates && r.duplicatesApiTracking) continue;
    const key = `${r.vendor}|${r.date}`;
    const existing = map.get(key);
    if (existing) {
      existing.amount_usd =
        Math.round((existing.amount_usd + r.amountUsd) * 100) / 100;
      existing.metadata.transactions.push({
        description: r.description,
        amount: r.amountUsd,
      });
    } else {
      map.set(key, {
        vendor: r.vendor,
        period_start: r.date,
        period_end: r.date,
        amount_usd: r.amountUsd,
        category: VENDOR_CATEGORY[r.vendor],
        source: "csv",
        metadata: {
          transactions: [{ description: r.description, amount: r.amountUsd }],
        },
      });
    }
  }
  return Array.from(map.values());
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured" },
      { status: 500 },
    );
  }

  let body: { csv?: string; includeDuplicates?: boolean };
  try {
    body = (await req.json()) as { csv?: string; includeDuplicates?: boolean };
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    );
  }

  const csv = (body.csv ?? "").trim();
  if (!csv) {
    return NextResponse.json(
      { ok: false, error: "csv is required" },
      { status: 400 },
    );
  }

  const includeDuplicates = body.includeDuplicates === true;
  const preview = parseChaseCsv(csv);

  if (preview.parseErrors.length && !preview.rows.length) {
    return NextResponse.json(
      { ok: false, error: preview.parseErrors[0], parseErrors: preview.parseErrors },
      { status: 400 },
    );
  }

  const skippedDuplicates = preview.rows.filter(
    (r) => r.duplicatesApiTracking,
  ).length;
  const aggregated = aggregate(preview.rows, includeDuplicates);

  if (!aggregated.length) {
    return NextResponse.json({
      ok: true,
      inserted: 0,
      transactionsParsed: preview.rows.length,
      skippedDuplicates,
      skippedNonCharges: preview.skippedNonCharges,
      parseErrors: preview.parseErrors,
      byVendor: {},
      note: includeDuplicates
        ? "no charges found"
        : "all charges matched API-tracked vendors and were skipped",
    });
  }

  const upsertRes = await fetch(
    `${SUPABASE_URL}/rest/v1/spend_line_items?on_conflict=vendor,period_start,period_end,source`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(aggregated),
    },
  );
  if (!upsertRes.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `upsert failed: ${upsertRes.status} ${await upsertRes.text()}`,
      },
      { status: 500 },
    );
  }

  const byVendor: Record<string, number> = {};
  for (const r of aggregated) {
    byVendor[r.vendor] =
      Math.round(((byVendor[r.vendor] ?? 0) + r.amount_usd) * 100) / 100;
  }

  return NextResponse.json({
    ok: true,
    inserted: aggregated.length,
    transactionsParsed: preview.rows.length,
    skippedDuplicates,
    skippedNonCharges: preview.skippedNonCharges,
    parseErrors: preview.parseErrors,
    byVendor,
  });
}
