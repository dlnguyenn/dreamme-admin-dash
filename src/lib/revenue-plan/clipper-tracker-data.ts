/**
 * Server side of the clipper tracker: weekly onboardings and trials by source,
 * the hand-entered spend rows (clipper_campaign_weeks, migration 0095), and
 * the per-creator codes from the Clippers tab. The rules live in
 * clipper-tracker.ts.
 */
import { clipperSlug } from "@/lib/clipperLinks";
import {
  CLIPPER_RULES,
  baselineFrom,
  baselineSpan,
  currentCall,
  trackerWeeks,
  type Baseline,
  type ClipperWeekEntry,
  type TrackerWeek,
  type WeekCounts,
} from "./clipper-tracker";
import { addDays, easternDate, easternMidnightIso, utcSinceForEasternDay, weekStart } from "./dates";
import { MissingTableError, mapLimit, num, sbAll, sbDelete, sbGet, sbUpsert } from "./db";
import { sourceGroup } from "./sources";
import { countOnboardings, loadSources, sourceStatus, type SourceStatus } from "./user-sources";
import { fetchTrialStarts } from "./value-per-trial-data";

export const TRACKER_WEEKS = 12;

interface EntryRow {
  week_start: string;
  views_bought: number | string | null;
  payouts_usd: number | string | null;
  fees_usd: number | string | null;
  tranche: string | null;
  note: string | null;
}

const toEntry = (r: EntryRow): ClipperWeekEntry => ({
  weekStart: r.week_start,
  viewsBought: r.views_bought == null ? null : num(r.views_bought),
  payoutsUsd: num(r.payouts_usd),
  feesUsd: num(r.fees_usd),
  tranche: r.tranche,
  note: r.note,
});

/** Campaign-level rows (clipper_id null). Null when the table does not exist yet. */
export async function fetchEntries(): Promise<ClipperWeekEntry[] | null> {
  try {
    const rows = await sbGet<EntryRow[]>(
      "internal",
      "clipper_campaign_weeks?select=week_start,views_bought,payouts_usd,fees_usd,tranche,note&clipper_id=is.null&order=week_start.asc",
    );
    return rows.map(toEntry);
  } catch (e) {
    if (e instanceof MissingTableError) return null;
    throw e;
  }
}

export function validateEntry(body: unknown): ClipperWeekEntry {
  const b = (body ?? {}) as Record<string, unknown>;
  const week = String(b.weekStart ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || weekStart(week) !== week) throw new Error("weekStart must be a Monday (YYYY-MM-DD)");
  const money = (v: unknown, name: string) => {
    const n = v === "" || v == null ? 0 : Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a number of dollars, 0 or more`);
    return Math.round(n * 100) / 100;
  };
  const views = b.viewsBought === "" || b.viewsBought == null ? null : Number(b.viewsBought);
  if (views != null && (!Number.isFinite(views) || views < 0)) throw new Error("viewsBought must be 0 or more");
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null);
  return {
    weekStart: week,
    viewsBought: views == null ? null : Math.round(views),
    payoutsUsd: money(b.payoutsUsd, "payoutsUsd"),
    feesUsd: money(b.feesUsd, "feesUsd"),
    tranche: text(b.tranche),
    note: text(b.note),
  };
}

export async function saveEntry(e: ClipperWeekEntry): Promise<void> {
  await sbUpsert(
    "clipper_campaign_weeks",
    [
      {
        week_start: e.weekStart,
        clipper_id: null,
        views_bought: e.viewsBought,
        payouts_usd: e.payoutsUsd,
        fees_usd: e.feesUsd,
        tranche: e.tranche,
        note: e.note,
        updated_at: new Date().toISOString(),
      },
    ],
    "week_start,clipper_id",
  );
}

export async function deleteEntry(week: string): Promise<void> {
  await sbDelete(`clipper_campaign_weeks?week_start=eq.${week}&clipper_id=is.null`);
}

export interface CreatorRow {
  id: string;
  name: string;
  code: string;
  slug: string;
  active: boolean;
  /** Trial starts carrying this creator's code since the tracker window began. */
  trials: number;
}

async function fetchCreators(sinceIso: string): Promise<CreatorRow[]> {
  const [clippers, trials] = await Promise.all([
    sbGet<{ id: string; name: string; code: string; token: string; active: boolean }[]>(
      "internal",
      "clippers?select=id,name,code,token,active&order=created_at.asc",
    ),
    sbAll<{ clipper_id: string }>(
      "internal",
      `rc_events?select=clipper_id&type=eq.INITIAL_PURCHASE&period_type=eq.TRIAL&environment=eq.PRODUCTION` +
        `&clipper_id=not.is.null&event_at=gte.${sinceIso}&order=event_at.asc,id.asc`,
    ),
  ]);
  const counts = new Map<string, number>();
  for (const t of trials) counts.set(t.clipper_id, (counts.get(t.clipper_id) ?? 0) + 1);
  return clippers.map((c) => ({ id: c.id, name: c.name, code: c.code, slug: clipperSlug(c), active: c.active, trials: counts.get(c.id) ?? 0 }));
}

export interface ClipperTrackerResponse {
  today: string;
  weeks: TrackerWeek[];
  baseline: Baseline | null;
  call: TrackerWeek | null;
  rules: typeof CLIPPER_RULES;
  /** False until migration 0095 is applied: entries cannot be saved yet. */
  entriesReady: boolean;
  creators: CreatorRow[];
  sources: SourceStatus;
}

export async function loadClipperTracker(now = new Date()): Promise<ClipperTrackerResponse> {
  const today = easternDate(now);
  const entries = await fetchEntries();
  const firstSpend = (entries ?? []).filter((e) => e.payoutsUsd + e.feesUsd > 0).map((e) => e.weekStart).sort()[0];
  const recent = weekStart(addDays(today, -7 * (TRACKER_WEEKS - 1)));
  // Reach back far enough for the six baseline weeks before the first spend week.
  const from = firstSpend && addDays(firstSpend, -7 * CLIPPER_RULES.baselineWeeks) < recent ? addDays(firstSpend, -7 * CLIPPER_RULES.baselineWeeks) : recent;
  const weeks: string[] = [];
  for (let w = from; w <= today; w = addDays(w, 7)) weeks.push(w);

  const [trials, status, creators] = await Promise.all([
    fetchTrialStarts(utcSinceForEasternDay(from)),
    sourceStatus(),
    fetchCreators(utcSinceForEasternDay(from)).catch(() => [] as CreatorRow[]),
  ]);
  const inWindow = trials.filter((t) => easternDate(t.at) >= from);
  const [sources, onboardings] = await Promise.all([
    loadSources(inWindow.map((t) => t.userId ?? ""), status.backend),
    mapLimit(weeks, 4, (w) => countOnboardings(easternMidnightIso(w), easternMidnightIso(addDays(w, 7)), status.backend)),
  ]);

  const counts: WeekCounts[] = weeks.map((w, i) => ({
    week: w,
    complete: addDays(w, 6) < today,
    onboardings: onboardings[i].all,
    tiktokOnboardings: onboardings[i].tiktok,
    trials: 0,
    metaTrials: 0,
    tiktokTrials: 0,
    nonMetaTrials: 0,
  }));
  const byWeek = new Map(counts.map((c) => [c.week, c]));
  for (const t of inWindow) {
    const c = byWeek.get(weekStart(easternDate(t.at)));
    if (!c) continue;
    c.trials++;
    // Unmatched trials (no user row) stay out of every source column.
    if (!t.userId || !sources.has(t.userId)) continue;
    const g = sourceGroup(sources.get(t.userId));
    if (g === "meta") c.metaTrials++;
    else {
      c.nonMetaTrials++;
      if (g === "tiktok") c.tiktokTrials++;
    }
  }

  const span = baselineSpan(counts, entries ?? []);
  const baseline = span ? baselineFrom(counts, span) : null;
  const tracked = baseline ? trackerWeeks(counts, entries ?? [], baseline) : [];
  return {
    today,
    weeks: tracked,
    baseline,
    call: currentCall(tracked),
    rules: CLIPPER_RULES,
    entriesReady: entries != null,
    creators,
    sources: status,
  };
}
