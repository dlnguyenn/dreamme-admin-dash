/**
 * /api/cron/cull-variants
 *
 * Daily-run kill-schedule cron. Reads `cull_schedule` rows whose
 * `target_date` is today or earlier and `executed_at` IS NULL, then for
 * each: pulls ad-level insights over the configured window, ranks ACTIVE
 * ads by the configured criterion, pauses the bottom N, logs the run.
 *
 * Criteria:
 *   - ctr: lower is worse. Pause bottom N.
 *   - reported_trial_cpa: higher is worse. Pause top N (by CPA).
 *
 * Safety: respects an optional `min_ratio_threshold` to skip culls when
 * the field is statistically too tight to make a meaningful decision.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import {
  fetchAdInsights,
  updateAdStatus,
  type AdInsightRow,
} from "@/lib/vendors/meta-ads";
import { resolveMeta } from "@/lib/meta-resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_ACCOUNT_ID = "act_1575502753719515";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

interface CullScheduleRow {
  id: string;
  adset_id: string;
  adset_label: string;
  phase_index: number;
  target_date: string;
  criterion: "ctr" | "reported_trial_cpa";
  window_days: number;
  cut_count: number;
  min_ratio_threshold: number | null;
  executed_at: string | null;
  notes: string | null;
}

async function sbFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  // PATCH/POST/DELETE may return empty body
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : ([] as unknown as T);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rankAds(
  rows: AdInsightRow[],
  criterion: "ctr" | "reported_trial_cpa",
): Array<{ ad_id: string; ad_name: string; score: number }> {
  const scored = rows.map((r) => {
    if (criterion === "ctr") {
      const ctr = r.impressions > 0 ? r.clicks / r.impressions : 0;
      return { ad_id: r.ad_id, ad_name: r.ad_name, score: ctr };
    }
    // reported_trial_cpa: higher is worse, so we score as the CPA value.
    // Ads with zero trial_starts get a sentinel "infinity-like" value so
    // they sort to the worst position.
    const cpa = r.startTrials > 0 ? r.spend / r.startTrials : Number.MAX_VALUE;
    return { ad_id: r.ad_id, ad_name: r.ad_name, score: cpa };
  });
  if (criterion === "ctr") {
    // lower CTR = worse. Sort ascending so first is worst.
    return scored.sort((a, b) => a.score - b.score);
  }
  // reported_trial_cpa: higher CPA = worse. Sort descending so first is worst.
  return scored.sort((a, b) => b.score - a.score);
}

function shouldSkipByThreshold(
  rankedWorstFirst: Array<{ score: number }>,
  cutCount: number,
  criterion: "ctr" | "reported_trial_cpa",
  threshold: number | null,
): { skip: boolean; reason?: string } {
  if (threshold === null || rankedWorstFirst.length === 0) return { skip: false };
  if (rankedWorstFirst.length <= cutCount) return { skip: false };
  const worstKept = rankedWorstFirst[cutCount].score;
  const bestOverall =
    criterion === "ctr"
      ? rankedWorstFirst[rankedWorstFirst.length - 1].score
      : rankedWorstFirst[rankedWorstFirst.length - 1].score;
  if (bestOverall === 0) return { skip: false };
  const ratio =
    criterion === "ctr"
      ? worstKept / bestOverall // CTR: want worst-kept >= threshold * best
      : bestOverall / worstKept; // CPA: want best <= worst / inverse-threshold
  if (criterion === "ctr" && ratio >= threshold) {
    return {
      skip: true,
      reason: `field too tight: worst-kept CTR ${ratio.toFixed(2)}× best ≥ threshold ${threshold}`,
    };
  }
  // For CPA, a low ratio means the field is tight (best CPA is close to worst's).
  // If best/worst > threshold, the field is tight enough to skip.
  if (criterion === "reported_trial_cpa" && ratio >= threshold) {
    return {
      skip: true,
      reason: `field too tight: best CPA ${ratio.toFixed(2)}× of worst-kept ≥ threshold ${threshold}`,
    };
  }
  return { skip: false };
}

async function executeSchedule(row: CullScheduleRow, accountId: string, accessToken: string): Promise<{
  ok: boolean;
  paused_ad_ids: string[];
  ranked_summary: unknown;
  error?: string;
}> {
  // Pull insights for the window ending yesterday (today's data isn't
  // complete yet for ranking purposes).
  const until = new Date();
  until.setDate(until.getDate() - 1);
  const since = new Date(until);
  since.setDate(since.getDate() - (row.window_days - 1));

  const insights = await fetchAdInsights({
    accountId,
    since: isoDate(since),
    until: isoDate(until),
    accessToken,
  });
  const adsetAds = insights.filter((r) => r.adset_id === row.adset_id);

  if (adsetAds.length === 0) {
    return {
      ok: false,
      paused_ad_ids: [],
      ranked_summary: [],
      error: "no ads found in adset window",
    };
  }

  const ranked = rankAds(adsetAds, row.criterion);
  const summary = ranked.map((r, i) => ({
    rank: i + 1,
    ad_id: r.ad_id,
    ad_name: r.ad_name,
    score: r.score,
  }));

  const skipCheck = shouldSkipByThreshold(
    ranked,
    row.cut_count,
    row.criterion,
    row.min_ratio_threshold,
  );
  if (skipCheck.skip) {
    return {
      ok: true,
      paused_ad_ids: [],
      ranked_summary: { ranked: summary, skipped: skipCheck.reason },
    };
  }

  const toPause = ranked.slice(0, row.cut_count);
  const paused_ad_ids: string[] = [];
  for (const t of toPause) {
    try {
      await updateAdStatus({ adId: t.ad_id, status: "PAUSED", accessToken });
      paused_ad_ids.push(t.ad_id);
    } catch (e) {
      return {
        ok: false,
        paused_ad_ids,
        ranked_summary: summary,
        error: `pause failed for ${t.ad_id}: ${(e as Error).message}`,
      };
    }
  }

  return {
    ok: true,
    paused_ad_ids,
    ranked_summary: summary,
  };
}

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  const meta = await resolveMeta();
  if (!meta) {
    return NextResponse.json(
      { ok: false, error: "No Meta token (OAuth connection missing + META_ACCESS_TOKEN unset/expired)" },
      { status: 500 },
    );
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase env missing" },
      { status: 500 },
    );
  }

  const accountId = process.env.META_AD_ACCOUNT_ID ?? DEFAULT_ACCOUNT_ID;
  const today = isoDate(new Date());

  // Find pending schedule rows
  const pending = await sbFetch<CullScheduleRow[]>(
    `cull_schedule?select=*&executed_at=is.null&target_date=lte.${today}&order=target_date.asc,phase_index.asc`,
  );

  const runs: Array<{
    schedule_id: string;
    adset_label: string;
    target_date: string;
    ok: boolean;
    paused_ad_ids: string[];
    error?: string;
  }> = [];

  for (const row of pending) {
    let result: Awaited<ReturnType<typeof executeSchedule>>;
    try {
      result = await executeSchedule(row, accountId, meta.token);
    } catch (e) {
      result = {
        ok: false,
        paused_ad_ids: [],
        ranked_summary: [],
        error: (e as Error).message,
      };
    }

    // Log execution
    await sbFetch("cull_execution_log", {
      method: "POST",
      body: JSON.stringify({
        schedule_id: row.id,
        ok: result.ok,
        paused_ad_ids: result.paused_ad_ids,
        ranked_summary: result.ranked_summary,
        error: result.error ?? null,
      }),
    });

    // Mark schedule row executed only if the run succeeded
    if (result.ok) {
      await sbFetch(`cull_schedule?id=eq.${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          executed_at: new Date().toISOString(),
          executed_log: `paused ${result.paused_ad_ids.length} ad(s)`,
        }),
      });
    }

    runs.push({
      schedule_id: row.id,
      adset_label: row.adset_label,
      target_date: row.target_date,
      ok: result.ok,
      paused_ad_ids: result.paused_ad_ids,
      error: result.error,
    });
  }

  return NextResponse.json({
    ok: true,
    today,
    pending_count: pending.length,
    runs,
  });
}
