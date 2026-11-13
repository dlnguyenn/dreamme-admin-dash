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
  fetchConnectorStatus,
  fetchSingularAdReport,
  fetchSingularCampaignReport,
  probeSingularBreakdown,
  singularConfigured,
  type SingularAdRow,
} from "@/lib/vendors/singular";
import { brokenConnectors, connectorAlerts, resolveFilter } from "@/lib/mmp/connector-health";

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

  // ?probe=<comma-separated dimensions>: ask Singular for installs and trials
  // by those dimensions (ad set, creative, ...) and return a summary. Reads
  // only: nothing is stored and the normal sync does not run.
  const probe = url.searchParams.get("probe");
  if (probe) {
    const dimensions = probe.split(",").map((d) => d.trim()).filter((d) => /^[a-z0-9_]+$/.test(d));
    if (!dimensions.length) {
      return NextResponse.json({ ok: false, error: "probe needs dimension names" }, { status: 400 });
    }
    try {
      const summary = await probeSingularBreakdown({ startDate: sinceDate, endDate: untilDate, dimensions, cohortPeriod });
      return NextResponse.json({ ok: true, window: { since: sinceDate, until: untilDate }, cohort_period: cohortPeriod, probe: summary });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
    }
  }

  // Connector health first and on its own: a broken login (e.g. Facebook's,
  // 2026-09-25 to 11-06) raises a critical alert on the Overview. Never fails
  // the sync.
  const connectors = await checkConnectors(utcDate(new Date(today.getTime() - 86_400_000)), utcDate(today));
  console.log("[sync-singular] connectors", JSON.stringify(connectors));

  // The ad set and ad report runs alongside the campaign one, into
  // singular_ad_daily. Its failure is reported in the response but never fails
  // the campaign sync, which the cost views depend on.
  const adPromise: Promise<{ rows: SingularAdRow[]; conversionPeriod: string } | Error> = fetchSingularAdReport({
    startDate: sinceDate,
    endDate: untilDate,
    cohortPeriod,
  }).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));

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
      { ok: false, error: (e as Error).message, ads: await syncAds(await adPromise, new Date().toISOString(), cohortPeriod), connectors },
      { status: 502 },
    );
  }

  const syncedAt = new Date().toISOString();
  const ads = await syncAds(await adPromise, syncedAt, cohortPeriod);
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
    paid_conversions: r.paid_conversions,
    cohort_period: cohortPeriod,
    conversion_period: report.conversionPeriod ?? cohortPeriod,
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
      resolved_conversion_event_id: report.resolvedConversionEventId ?? null,
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
      ads,
      connectors,
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
      { ok: false, error: `upsert failed: ${res.status} ${await res.text()}`, ads, connectors },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    ads,
    connectors,
    upserted: rows.length,
    campaigns: new Set(rows.map((r) => r.campaign_id)).size,
    trial_starts: rows.reduce((a, r) => a + r.trial_starts, 0),
    paid_conversions: rows.reduce((a, r) => a + r.paid_conversions, 0),
    cohort_period: cohortPeriod,
    conversion_period: report.conversionPeriod ?? cohortPeriod,
    window: { since: sinceDate, until: untilDate },
    unmapped_keys: report.unmappedKeys,
    resolved_trial_event_id: report.resolvedTrialEventId ?? null,
    resolved_subscribe_event_id: report.resolvedSubscribeEventId ?? null,
    // Null until RevenueCat's trial-converted event is registered in Singular
    // (docs/singular-mmp-setup.md, step 6). Then paid_conversions starts counting.
    resolved_conversion_event_id: report.resolvedConversionEventId ?? null,
    sample_raw: report.sampleRaw,
  });
}

/** Upsert the ad set and ad rows into singular_ad_daily; a summary, never a throw. */
async function syncAds(
  result: { rows: SingularAdRow[]; conversionPeriod: string } | Error,
  syncedAt: string,
  cohortPeriod: string,
): Promise<{ ok: boolean; upserted: number; ads: number; trial_starts: number; paid_conversions: number; revenue: number; error?: string }> {
  if (result instanceof Error) return { ok: false, upserted: 0, ads: 0, trial_starts: 0, paid_conversions: 0, revenue: 0, error: result.message };
  const rows = result.rows.map((r) => ({
    ...r,
    cohort_period: cohortPeriod,
    conversion_period: result.conversionPeriod,
    synced_at: syncedAt,
  }));
  const summary = {
    upserted: rows.length,
    ads: new Set(rows.filter((r) => r.ad_id).map((r) => r.ad_id)).size,
    trial_starts: rows.reduce((a, r) => a + r.trial_starts, 0),
    paid_conversions: rows.reduce((a, r) => a + r.paid_conversions, 0),
    revenue: Math.round(rows.reduce((a, r) => a + r.revenue, 0) * 100) / 100,
  };
  if (!rows.length) return { ok: true, ...summary };
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/singular_ad_daily?on_conflict=source,campaign_id,adset_id,ad_id,date`,
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
  if (!res.ok) return { ok: false, ...summary, upserted: 0, error: `upsert failed: ${res.status} ${(await res.text()).slice(0, 200)}` };
  return { ok: true, ...summary };
}

type ConnectorCheck = {
  ok: boolean;
  checked: number;
  broken: Array<{ id: string; source: string; status: string }>;
  alerts_written: number;
  error?: string;
};

/**
 * Ask Singular for every connector's status, raise a critical marketing alert
 * per broken one (dated today, so one row a day while it stays broken), and
 * resolve open connector alerts for connectors that recovered. A summary,
 * never a throw.
 */
async function checkConnectors(dataDate: string, alertDate: string): Promise<ConnectorCheck> {
  const headers = {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
  try {
    const list = await fetchConnectorStatus(dataDate);
    const broken = brokenConnectors(list);
    const alerts = connectorAlerts(broken, alertDate);
    if (alerts.length) {
      const ins = await fetch(`${SUPABASE_URL}/rest/v1/marketing_alerts?on_conflict=alert_date,scope,campaign_id,metric`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(alerts),
      });
      if (!ins.ok) throw new Error(`marketing_alerts upsert failed: ${ins.status} ${(await ins.text()).slice(0, 200)}`);
    }
    const fix = await fetch(`${SUPABASE_URL}/rest/v1/marketing_alerts?${resolveFilter(broken)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ resolved_at: new Date().toISOString() }),
    });
    if (!fix.ok) throw new Error(`marketing_alerts resolve failed: ${fix.status} ${(await fix.text()).slice(0, 200)}`);
    return {
      ok: true,
      checked: list.length,
      broken: broken.map((c) => ({ id: c.data_connector_id, source: c.data_connector_source_name, status: c.status })),
      alerts_written: alerts.length,
    };
  } catch (e) {
    console.error("[sync-singular] connector check failed", e);
    return { ok: false, checked: 0, broken: [], alerts_written: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
