/**
 * Server side of the Overview trial insights (rules: trial-insights.ts).
 * Every input but the trial events is optional: a Mixpanel, Meta or
 * attribution failure drops that line of evidence, never the panel.
 */
import { sbAll, sbGet } from "@/lib/revenue-plan/db";
import { spGet } from "@/lib/support/db";
import { dailyUniques, mixpanelConfigured } from "@/lib/vendors/mixpanel";
import { easternDate, easternDateOffset } from "@/lib/socialViews";
import { cached } from "@/lib/dad-cache";
import {
  PACE_BASIS_DAYS,
  buildTrialInsights,
  type LoggedChange,
  type MetaInsightRow,
  type SourceDay,
  type TrialEvent,
  type TrialInsights,
} from "@/lib/trial-insights";
import type { AttributionSeries } from "@/lib/overview";

async function fetchTrialEvents(now: Date): Promise<TrialEvent[]> {
  // One day of slack on top of the basis window, for the Eastern offset.
  const since = new Date(now.getTime() - (PACE_BASIS_DAYS + 3) * 86_400_000).toISOString();
  // Same definition as rc_trial_starts_daily: environment NULL counts too,
  // which a plain environment=neq.SANDBOX would silently drop.
  return sbAll<TrialEvent>(
    "internal",
    `rc_events?select=event_at,store&type=eq.INITIAL_PURCHASE&period_type=eq.TRIAL` +
      `&or=(environment.is.null,environment.neq.SANDBOX)&event_at=gte.${since}&order=event_at.asc,id.asc`,
  );
}

async function fetchOnboarding(now: Date): Promise<Map<string, number> | null> {
  if (!mixpanelConfigured()) return null;
  return dailyUniques("onboarding_started", easternDateOffset(8, now), easternDate(now));
}

async function fetchMeta(now: Date): Promise<MetaInsightRow[]> {
  return sbGet<MetaInsightRow[]>(
    "internal",
    `ad_insights_daily?select=date,campaign_name,spend,installs,trial_starts` +
      `&date=gte.${easternDateOffset(9, now)}&order=date.asc&limit=5000`,
  );
}

async function fetchSources(
  now: Date,
  attribution: () => Promise<AttributionSeries>,
): Promise<SourceDay[] | null> {
  const series = await attribution();
  const day = series.byDay[easternDateOffset(1, now)];
  if (!day) return null;
  return day.rows.map((r) => ({ source: r.source, count: r.today, avgPerDay: r.avgPerDay }));
}

async function fetchChanges(now: Date): Promise<LoggedChange[]> {
  const from = easternDateOffset(5, now);
  return spGet<LoggedChange[]>(
    `experiment_log?select=title,kind,start_date,end_date&or=(start_date.gte.${from},end_date.gte.${from})&limit=50`,
  );
}

const soft = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export async function loadTrialInsights(
  attribution: () => Promise<AttributionSeries>,
  now = new Date(),
): Promise<TrialInsights> {
  const [events, onboarding, meta, sources, changes] = await Promise.all([
    fetchTrialEvents(now),
    soft(fetchOnboarding(now)),
    soft(fetchMeta(now)),
    soft(fetchSources(now, attribution)),
    soft(fetchChanges(now)),
  ]);
  return buildTrialInsights({ events, onboarding, meta, sources, changes }, now);
}

/** The attribution series through its own cache entry, so this doesn't recompute it. */
export function cachedAttribution(job: { policy: Parameters<typeof cached>[1]; run: () => Promise<unknown> }) {
  return async () => (await cached("overview-attribution", job.policy, job.run)).value as AttributionSeries;
}
