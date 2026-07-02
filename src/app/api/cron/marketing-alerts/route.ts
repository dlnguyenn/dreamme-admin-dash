// Daily anomaly detection over ad_insights_daily — the Singular-style alerting
// pass. For yesterday (UTC), per campaign and account-wide, compares spend /
// CPI / CTR / CPM against the trailing-14-day baseline and writes a
// marketing_alerts row when |z| >= 2 (warn) or >= 3 (critical). Alerts are
// deduped per (day, scope, campaign, metric) so re-runs are idempotent.
//
// Runs after sync-ad-insights (07:00 UTC) via vercel.json. Reads with the anon
// key; writes with the service role (marketing_alerts is RLS anon-read-only).
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

// Ignore campaigns spending less than this yesterday — z-scores on pocket
// change produce noise, not signal.
const MIN_SPEND = 15;
// Need at least this many trailing days with delivery to form a baseline.
const MIN_BASELINE_DAYS = 5;

type DailyRow = {
  date: string;
  campaign_id: string | null;
  campaign_name: string | null;
  spend: string | number | null;
  installs: string | number | null;
  impressions: string | number | null;
  clicks: string | number | null;
};

type MetricPoint = { spend: number; cpi: number | null; ctr: number | null; cpm: number | null };

const num = (v: string | number | null | undefined): number =>
  v == null ? 0 : typeof v === "number" ? v : Number(v) || 0;

function toPoint(rows: DailyRow[]): MetricPoint {
  const spend = rows.reduce((s, r) => s + num(r.spend), 0);
  const installs = rows.reduce((s, r) => s + num(r.installs), 0);
  const impressions = rows.reduce((s, r) => s + num(r.impressions), 0);
  const clicks = rows.reduce((s, r) => s + num(r.clicks), 0);
  return {
    spend,
    cpi: installs > 0 ? spend / installs : null,
    ctr: impressions > 0 ? (clicks * 100) / impressions : null,
    cpm: impressions > 0 ? (spend * 1000) / impressions : null,
  };
}

function meanStd(xs: number[]): { mean: number; std: number } {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
  return { mean, std: Math.sqrt(variance) };
}

type Alert = {
  alert_date: string;
  scope: "account" | "campaign";
  campaign_id: string | null;
  campaign_name: string | null;
  metric: string;
  value: number;
  baseline: number;
  z: number;
  direction: "spike" | "drop";
  severity: "warn" | "critical";
  message: string;
};

function evaluate(
  scope: "account" | "campaign",
  campaignId: string | null,
  campaignName: string | null,
  alertDate: string,
  yesterday: MetricPoint,
  baselineDays: MetricPoint[],
): Alert[] {
  const out: Alert[] = [];
  const metrics: Array<{ key: "spend" | "cpi" | "ctr" | "cpm"; label: string; fmt: (v: number) => string }> = [
    { key: "spend", label: "Spend", fmt: (v) => `$${v.toFixed(2)}` },
    { key: "cpi", label: "CPI", fmt: (v) => `$${v.toFixed(2)}` },
    { key: "ctr", label: "CTR", fmt: (v) => `${v.toFixed(2)}%` },
    { key: "cpm", label: "CPM", fmt: (v) => `$${v.toFixed(2)}` },
  ];
  for (const m of metrics) {
    const current = yesterday[m.key];
    if (current == null) continue;
    const series = baselineDays
      .map((d) => d[m.key])
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (series.length < MIN_BASELINE_DAYS) continue;
    const { mean, std } = meanStd(series);
    if (std <= 0 || mean <= 0) continue;
    const z = (current - mean) / std;
    if (Math.abs(z) < 2) continue;
    const direction = z > 0 ? "spike" : "drop";
    // A CTR drop or a CPI/CPM/spend spike is the "bad" direction; still record
    // both directions — a spend drop usually means delivery collapsed.
    const severity = Math.abs(z) >= 3 ? "critical" : "warn";
    const name = scope === "account" ? "Account" : campaignName ?? campaignId ?? "campaign";
    out.push({
      alert_date: alertDate,
      scope,
      campaign_id: campaignId,
      campaign_name: campaignName,
      metric: m.key,
      value: Number(current.toFixed(4)),
      baseline: Number(mean.toFixed(4)),
      z: Number(z.toFixed(2)),
      direction,
      severity,
      message: `${name}: ${m.label} ${direction} — ${m.fmt(current)} vs ${m.fmt(mean)} 14d avg (z=${z.toFixed(1)})`,
    });
  }
  return out;
}

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!SUPABASE_URL || !SUPABASE_ANON || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase env missing (URL / anon / service role)" },
      { status: 500 },
    );
  }

  // Yesterday UTC + trailing 14 days before it.
  const today = new Date();
  const yest = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
  const start = new Date(yest.getTime() - 14 * 86400_000);
  const yestStr = yest.toISOString().slice(0, 10);
  const startStr = start.toISOString().slice(0, 10);

  const url =
    `${SUPABASE_URL}/rest/v1/ad_insights_daily` +
    `?select=date,campaign_id,campaign_name,spend,installs,impressions,clicks` +
    `&date=gte.${startStr}&date=lte.${yestStr}&limit=20000`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `ad_insights_daily read failed: ${res.status}` },
      { status: 502 },
    );
  }
  const rows = (await res.json()) as DailyRow[];
  if (!rows.length) return NextResponse.json({ ok: true, alerts: 0, note: "no insight rows" });

  // Group rows by date, and by (campaign, date).
  const byDate = new Map<string, DailyRow[]>();
  const byCampaign = new Map<string, Map<string, DailyRow[]>>();
  const campaignNames = new Map<string, string | null>();
  for (const r of rows) {
    (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(r);
    const cid = r.campaign_id ?? "unknown";
    const inner = byCampaign.get(cid) ?? byCampaign.set(cid, new Map()).get(cid)!;
    (inner.get(r.date) ?? inner.set(r.date, []).get(r.date)!).push(r);
    if (!campaignNames.has(cid)) campaignNames.set(cid, r.campaign_name);
  }

  const baselineDates = [...byDate.keys()].filter((d) => d < yestStr).sort();
  const alerts: Alert[] = [];

  // Account-wide.
  const yestRows = byDate.get(yestStr) ?? [];
  if (yestRows.length) {
    const yPoint = toPoint(yestRows);
    if (yPoint.spend >= MIN_SPEND) {
      const base = baselineDates.map((d) => toPoint(byDate.get(d)!));
      alerts.push(...evaluate("account", null, null, yestStr, yPoint, base));
    }
  }

  // Per campaign.
  for (const [cid, dates] of byCampaign) {
    const yRows = dates.get(yestStr);
    if (!yRows) continue;
    const yPoint = toPoint(yRows);
    if (yPoint.spend < MIN_SPEND) continue;
    const base = baselineDates
      .filter((d) => dates.has(d))
      .map((d) => toPoint(dates.get(d)!));
    alerts.push(
      ...evaluate("campaign", cid, campaignNames.get(cid) ?? null, yestStr, yPoint, base),
    );
  }

  // Upsert (idempotent on the dedupe index).
  if (alerts.length) {
    const ins = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_alerts?on_conflict=alert_date,scope,campaign_id,metric`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(alerts),
      },
    );
    if (!ins.ok) {
      const body = await ins.text();
      return NextResponse.json(
        { ok: false, error: `marketing_alerts upsert failed: ${ins.status} ${body}` },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    date: yestStr,
    alerts: alerts.length,
    critical: alerts.filter((a) => a.severity === "critical").length,
    messages: alerts.map((a) => a.message),
  });
}
