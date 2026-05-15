import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import {
  fetchChart,
  fetchOverview,
  revenueCatConfigured,
  valuesByDate,
} from "@/lib/vendors/revenuecat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function sbUpsert(
  table: string,
  conflict: string,
  rows: unknown[],
): Promise<void> {
  if (!rows.length) return;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflict}`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) {
    throw new Error(`upsert ${table} failed: ${res.status} ${await res.text()}`);
  }
}

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!revenueCatConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "RevenueCat not configured — set REVENUECAT_API_KEY and REVENUECAT_PROJECT_ID",
      },
      { status: 500 },
    );
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured" },
      { status: 500 },
    );
  }

  const today = new Date();
  const start = new Date(today.getTime() - 35 * 24 * 60 * 60 * 1000);
  const startDate = utcDate(start);
  const endDate = utcDate(today);
  const syncedAt = new Date().toISOString();

  let overview: Awaited<ReturnType<typeof fetchOverview>>;
  let charts: Awaited<ReturnType<typeof fetchChart>>[];
  try {
    [overview, ...charts] = await Promise.all([
      fetchOverview(),
      fetchChart({ chartName: "revenue", startDate, endDate, resolution: "day" }),
      fetchChart({ chartName: "trials_new", startDate, endDate, resolution: "day" }),
      fetchChart({
        chartName: "trial_conversion_rate",
        startDate,
        endDate,
        resolution: "day",
      }),
      fetchChart({
        chartName: "ltv_per_paying_customer",
        startDate,
        endDate,
        resolution: "day",
        selectors: { customer_lifetime: "30_days" },
      }),
      fetchChart({ chartName: "mrr", startDate, endDate, resolution: "day" }),
      fetchChart({ chartName: "actives", startDate, endDate, resolution: "day" }),
      fetchChart({
        chartName: "customers_new",
        startDate,
        endDate,
        resolution: "day",
      }),
      fetchChart({
        chartName: "trials_new",
        startDate,
        endDate,
        resolution: "day",
        segment: "attribution_ad",
      }),
    ]);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 502 },
    );
  }

  const [
    revenueChart,
    trialsNewChart,
    conversionChart,
    ltvChart,
    mrrChart,
    activesChart,
    newCustomersChart,
    perAdTrialsChart,
  ] = charts;

  // trial_conversion_rate measures: 0=Trial Starts, 1=Conversions, 2=Expirations,
  // 3=Pending, 4=Conversion Rate (matches the schema we saw in MCP).
  const trialStartsByDate = valuesByDate(conversionChart, 0);
  const conversionsByDate = valuesByDate(conversionChart, 1);
  const conversionRateByDate = valuesByDate(conversionChart, 4);

  // actives measures: 0=Active Subscriptions, 1=Active Trials (per RC schema).
  const activeSubsByDate = valuesByDate(activesChart, 0);
  const activeTrialsByDate = valuesByDate(activesChart, 1);

  const revenueByDate = valuesByDate(revenueChart, 0);
  const newTrialsByDate = valuesByDate(trialsNewChart, 0);
  const ltvByDate = valuesByDate(ltvChart, 0);
  const mrrByDate = valuesByDate(mrrChart, 0);
  const newCustomersByDate = valuesByDate(newCustomersChart, 0);

  // Build per-day account rows.
  const allDates = new Set<string>([
    ...revenueByDate.keys(),
    ...newTrialsByDate.keys(),
    ...trialStartsByDate.keys(),
    ...activeSubsByDate.keys(),
    ...mrrByDate.keys(),
  ]);
  const accountRows: unknown[] = [];
  for (const date of allDates) {
    accountRows.push({
      date,
      mrr: mrrByDate.get(date) ?? null,
      revenue: revenueByDate.get(date) ?? 0,
      active_trials: Math.round(activeTrialsByDate.get(date) ?? 0),
      active_subscriptions: Math.round(activeSubsByDate.get(date) ?? 0),
      new_customers: Math.round(newCustomersByDate.get(date) ?? 0),
      trial_starts: Math.round(
        trialStartsByDate.get(date) ?? newTrialsByDate.get(date) ?? 0,
      ),
      trial_conversions: Math.round(conversionsByDate.get(date) ?? 0),
      trial_conversion_rate: conversionRateByDate.get(date) ?? null,
      ltv_30d_per_paying_customer: ltvByDate.get(date) ?? null,
      synced_at: syncedAt,
    });
  }

  // Per-ad rows: each value carries a segment index. Skip the "Total"
  // segment (is_total=true) and the unattributed bucket (display_name empty
  // or "No Attribution"). Today this writes 0 rows for DreamMe; lights up
  // automatically once iOS attribution wiring ships.
  const adRows: unknown[] = [];
  const adRowMap = new Map<string, Map<string, number>>(); // ad_id → date → trial_starts
  const segments = perAdTrialsChart.segments ?? [];
  for (const v of perAdTrialsChart.values) {
    if (v.segment === undefined) continue;
    const seg = segments[v.segment];
    if (!seg || seg.is_total) continue;
    const adId = (seg.display_name ?? "").trim();
    if (!adId || adId.toLowerCase() === "no attribution") continue;
    const date = new Date(v.cohort * 1000).toISOString().slice(0, 10);
    let m = adRowMap.get(adId);
    if (!m) {
      m = new Map();
      adRowMap.set(adId, m);
    }
    m.set(date, (m.get(date) ?? 0) + (Number(v.value) || 0));
  }
  for (const [adId, byDate] of adRowMap) {
    for (const [date, trialStarts] of byDate) {
      adRows.push({
        ad_id: adId,
        date,
        trial_starts: Math.round(trialStarts),
        synced_at: syncedAt,
      });
    }
  }

  try {
    await sbUpsert("rc_account_metrics_daily", "date", accountRows);
    await sbUpsert("rc_ad_metrics_daily", "ad_id,date", adRows);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    overview,
    accountRows: accountRows.length,
    adRows: adRows.length,
    window: { since: startDate, until: endDate },
  });
}
