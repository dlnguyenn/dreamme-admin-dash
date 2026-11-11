/**
 * Every precomputed DAD payload, by cache key (src/lib/dad-cache.ts). The
 * routes serve these and /api/cron/warm-cache recomputes them all every 10
 * minutes. Each job's `run` is exactly what its route used to compute per
 * request, so a cached and an uncached response are the same shape.
 */
import { POLICY, type CachePolicy } from "@/lib/dad-cache";
import { buildOverview, fetchAttributionSeries } from "@/lib/overview";
import { DEFAULT_WEEKS, loadValuePerTrial, metaBreakEven } from "@/lib/revenue-plan/value-per-trial-data";
import { loadClipperTracker } from "@/lib/revenue-plan/clipper-tracker-data";
import { loadScorecard } from "@/lib/revenue-plan/scorecard-data";
import { HOLDOUT_TESTS, defaultTest, summarize, type HoldoutTest } from "@/lib/revenue-plan/switchback";
import { fetchSwitchbackRows } from "@/lib/revenue-plan/switchback-data";
import { fetchChart } from "@/lib/vendors/revenuecat";
import { transformTrialChart, type PricingExperimentResponse } from "@/lib/pricing-experiment";
import { fetchMmp } from "@/lib/mmp/data";
import { fetchMetaLive } from "@/lib/mmp/meta-live";
import { cachedAttribution, loadTrialInsights } from "@/lib/trial-insights-data";

export interface CacheJob {
  policy: CachePolicy;
  run: () => Promise<unknown>;
}

export async function loadSwitchback(test: HoldoutTest) {
  const [rows, breakEven] = await Promise.all([fetchSwitchbackRows(test), metaBreakEven()]);
  return {
    tests: HOLDOUT_TESTS.map((t) => ({ id: t.id, title: t.title, status: t.status, from: t.phases[0].from })),
    today: rows.today,
    days: rows.days,
    names: rows.names,
    platforms: rows.platforms,
    sources: rows.sources,
    summary: summarize(test, rows.days, rows.today, breakEven, rows.names),
  };
}

const PRICING_WINDOW_DAYS = 84; // 12 weeks: covers pre-change baselines + the reads

export async function loadPricingExperiment(): Promise<PricingExperimentResponse> {
  const end = new Date();
  const start = new Date(end.getTime() - PRICING_WINDOW_DAYS * 86_400_000);
  const chart = await fetchChart({
    chartName: "trial_conversion_rate",
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    resolution: "week",
    segment: "product_duration",
  });
  return { fetchedAt: new Date().toISOString(), weeks: transformTrialChart(chart) };
}

export async function loadMmpPayload() {
  const [data, meta] = await Promise.all([
    fetchMmp(),
    fetchMetaLive().catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))),
  ]);
  return {
    ...data,
    meta: meta instanceof Error ? null : meta,
    metaError: meta instanceof Error ? meta.message : null,
  };
}

export const valuePerTrialKey = (weeks: number) => `plan-value-per-trial:${weeks}`;
export const switchbackKey = (id: string) => `switchback:${id}`;

/** What the warm job recomputes: the default view of each slow tab. */
export function cacheJobs(): Record<string, CacheJob> {
  const jobs: Record<string, CacheJob> = {
    overview: { policy: POLICY.live, run: () => buildOverview() },
    "overview-attribution": { policy: POLICY.live, run: () => fetchAttributionSeries() },
    [valuePerTrialKey(DEFAULT_WEEKS)]: { policy: POLICY.daily, run: () => loadValuePerTrial(DEFAULT_WEEKS) },
    "plan-clipper-tracker": { policy: POLICY.daily, run: () => loadClipperTracker() },
    "plan-scorecard": { policy: POLICY.daily, run: () => loadScorecard() },
    "pricing-experiment": { policy: POLICY.daily, run: () => loadPricingExperiment() },
    mmp: { policy: POLICY.daily, run: () => loadMmpPayload() },
  };
  // After overview-attribution, which it reads through the cache.
  jobs["trial-insights"] = {
    policy: POLICY.live,
    run: () => loadTrialInsights(cachedAttribution(jobs["overview-attribution"])),
  };
  const test = defaultTest();
  if (test) jobs[switchbackKey(test.id)] = { policy: POLICY.daily, run: () => loadSwitchback(test) };
  return jobs;
}
