import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import {
  fetchTikTokAdInsights,
  tiktokAdsConfigured,
} from "@/lib/vendors/tiktok-ads";

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

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!tiktokAdsConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "TikTok Ads not configured — set TIKTOK_ADS_ACCESS_TOKEN and TIKTOK_ADVERTISER_ID (see docs/tiktok-ads-api-setup.md)",
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

  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days") ?? "35");
  const days =
    Number.isFinite(daysParam) && daysParam > 0
      ? Math.min(daysParam, 90)
      : 35;
  const today = new Date();
  const since = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const sinceDate = utcDate(since);
  const untilDate = utcDate(today);

  let insights: Awaited<ReturnType<typeof fetchTikTokAdInsights>>;
  try {
    insights = await fetchTikTokAdInsights({
      startDate: sinceDate,
      endDate: untilDate,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 502 },
    );
  }

  const syncedAt = new Date().toISOString();
  const rows = insights.map((r) => ({
    ad_id: r.ad_id,
    date: r.date,
    ad_name: r.ad_name || null,
    adgroup_id: r.adgroup_id || null,
    adgroup_name: r.adgroup_name || null,
    campaign_id: r.campaign_id || null,
    campaign_name: r.campaign_name || null,
    status: r.status || null,
    operation_status: r.operation_status || null,
    spend: r.spend,
    impressions: r.impressions,
    clicks: r.clicks,
    ctr: r.ctr,
    cpm: r.cpm,
    video_play_actions: r.video_play_actions,
    video_views_p100: r.video_views_p100,
    installs: r.installs,
    trial_starts: r.trial_starts,
    purchases: r.purchases,
    purchase_value: r.purchase_value,
    is_spark_ad: r.is_spark_ad,
    spark_creator_username: r.spark_creator_username || null,
    spark_video_id: r.spark_video_id || null,
    spark_video_url: r.spark_video_url || null,
    thumbnail_url: r.thumbnail_url || null,
    platform: "tiktok",
    synced_at: syncedAt,
  }));

  if (!rows.length) {
    return NextResponse.json({
      ok: true,
      upserted: 0,
      window: { since: sinceDate, until: untilDate },
      note: "no TikTok ad rows returned — either no spend in window or no ads running yet",
    });
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tiktok_ad_insights_daily?on_conflict=ad_id,date`,
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

  const sparkRows = rows.filter((r) => r.is_spark_ad).length;
  return NextResponse.json({
    ok: true,
    upserted: rows.length,
    spark_rows: sparkRows,
    window: { since: sinceDate, until: untilDate },
  });
}
