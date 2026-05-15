import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import {
  fetchAdInsightsWithCreative,
  metaAdsConfigured,
} from "@/lib/vendors/meta-ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";
const DEFAULT_ACCOUNT_ID = "act_1575502753719515";

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function safeDiv(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!metaAdsConfigured()) {
    return NextResponse.json(
      { ok: false, error: "META_ACCESS_TOKEN not set" },
      { status: 500 },
    );
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured" },
      { status: 500 },
    );
  }

  const accountId = process.env.META_AD_ACCOUNT_ID ?? DEFAULT_ACCOUNT_ID;
  const today = new Date();
  const since = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
  const sinceDate = utcDate(since);
  const untilDate = utcDate(today);

  let insights: Awaited<ReturnType<typeof fetchAdInsightsWithCreative>>;
  try {
    insights = await fetchAdInsightsWithCreative({
      accountId,
      since: sinceDate,
      until: untilDate,
      timeIncrement: 1,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 502 },
    );
  }

  const rows = insights
    .filter((r) => r.date)
    .map((r) => ({
      ad_id: r.ad_id,
      date: r.date,
      ad_name: r.ad_name || null,
      adset_id: r.adset_id || null,
      adset_name: r.adset_name || null,
      campaign_id: r.campaign_id || null,
      campaign_name: r.campaign_name || null,
      status: r.status || null,
      effective_status: r.effective_status || null,
      spend: r.spend,
      impressions: r.impressions,
      clicks: r.clicks,
      unique_clicks: r.unique_clicks,
      ctr: safeDiv(r.clicks, r.impressions),
      cpm: safeDiv(r.spend * 1000, r.impressions),
      installs: r.installs,
      trial_starts: r.startTrials,
      purchases: r.purchases,
      purchase_value: r.purchase_value,
      creative_id: r.creative_id || null,
      creative_name: r.creative_name || null,
      thumbnail_url: r.thumbnail_url || null,
      image_url: r.image_url || null,
      video_id: r.video_id || null,
      message: r.message || null,
      headline: r.headline || null,
      synced_at: new Date().toISOString(),
    }));

  if (!rows.length) {
    return NextResponse.json({ ok: true, upserted: 0 });
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ad_insights_daily?on_conflict=ad_id,date`,
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
    return NextResponse.json(
      {
        ok: false,
        error: `upsert failed: ${res.status} ${await res.text()}`,
      },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    upserted: rows.length,
    window: { since: sinceDate, until: untilDate },
  });
}
