/**
 * Pull per-campaign cost + cohort trial counts from Singular into
 * singular_campaign_daily.
 *
 * ── WHY THIS RE-UPSERTS THE WHOLE WINDOW EVERY RUN ────────────────────────
 * This looks like wasteful over-fetching. It is not, and changing it to an
 * incremental "sync yesterday only" would silently corrupt the data.
 *
 * Singular cohort metrics are anchored to the INSTALL date and RECOMPUTED on
 * every report run. The row for install-date D holds the trials those D-installs
 * have started *as of now* — not as of D. A 7-day cohort on a 2-day-old install
 * day is only 2 days matured. Syncing each day once would freeze every day at
 * its near-zero day-1 value forever.
 *
 * So: the default window is the full 35 days, re-upserted each run. 35 > the
 * longest cohort period we request; if anyone adds a 60d period, this window
 * must grow with it.
 *
 * Schedule is 17:00 UTC, not the 07:00-07:45 ad-sync cluster: Singular's Meta
 * cost connector is only ready ~08:00 account-local. Consequence to know about
 * — marketing-alerts at 07:45 UTC reads Singular data ~15h stale.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import {
  fetchSingularCampaignReport,
  singularConfigured,
} from "@/lib/vendors/singular";

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
  if (!singularConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Singular not configured — set SINGULAR_REPORTING_API_KEY (see docs/singular-mmp-setup.md)",
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
    Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 90) : 35;
  const cohortPeriod = url.searchParams.get("cohort") ?? "7d";
  const today = new Date();
  const since = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  const sinceDate = utcDate(since);
  const untilDate = utcDate(today);

  let report: Awaited<ReturnType<typeof fetchSingularCampaignReport>>;
  try {
    report = await fetchSingularCampaignReport({
      startDate: sinceDate,
      endDate: untilDate,
      cohortPeriod,
    });
  } catch (e) {
    // Vendor failures are 502 (ours are 500), so cron just retries tomorrow.
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 502 },
    );
  }

  const syncedAt = new Date().toISOString();
  const rows = report.rows.map((r) => ({
    source: r.source,
    campaign_id: r.campaign_id,
    date: r.date,
    campaign_name: r.campaign_name || null,
    os: r.os || null,
    spend: r.spend,
    installs: r.installs,
    adn_installs: r.adn_installs,
    tracker_installs: r.tracker_installs,
    trial_starts: r.trial_starts,
    subscribes: r.subscribes,
    revenue: r.revenue,
    cohort_period: cohortPeriod,
    synced_at: syncedAt,
  }));

  // One greppable line in the function logs (Hobby retains 1h — read soon
  // after a run). This is how we distinguish "trials were never requested"
  // (resolved id null) from "requested but keyed differently" (see raw_keys)
  // without needing the response body. Fires on the empty path too.
  console.log(
    "[sync-singular] diagnostics",
    JSON.stringify({
      resolved_trial_event_id: report.resolvedTrialEventId ?? null,
      resolved_subscribe_event_id: report.resolvedSubscribeEventId ?? null,
      unmapped_keys: report.unmappedKeys,
      raw_keys: report.sampleRaw ? Object.keys(report.sampleRaw).sort() : null,
    }),
  );

  if (!rows.length) {
    return NextResponse.json({
      ok: true,
      upserted: 0,
      window: { since: sinceDate, until: untilDate },
      // Surfaced even on the empty path: if the response shape differs from
      // what the (docs-derived, never-yet-run-live) mapper expects, this is
      // what tells us — rather than an empty dashboard with no explanation.
      unmapped_keys: report.unmappedKeys,
      sample_raw: report.sampleRaw,
      note: "no Singular rows returned — either no attributed spend in window, the events are not yet registered in Settings > Events (~24h), or the response shape differs from the mapper (check unmapped_keys/sample_raw)",
    });
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/singular_campaign_daily?on_conflict=source,campaign_id,date`,
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
      { ok: false, error: `upsert failed: ${res.status} ${await res.text()}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    upserted: rows.length,
    campaigns: new Set(rows.map((r) => r.campaign_id)).size,
    trial_starts: rows.reduce((a, r) => a + r.trial_starts, 0),
    cohort_period: cohortPeriod,
    window: { since: sinceDate, until: untilDate },
    unmapped_keys: report.unmappedKeys,
    resolved_trial_event_id: report.resolvedTrialEventId ?? null,
    resolved_subscribe_event_id: report.resolvedSubscribeEventId ?? null,
    sample_raw: report.sampleRaw,
  });
}
