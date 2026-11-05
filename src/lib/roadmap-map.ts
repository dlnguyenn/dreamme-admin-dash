/**
 * Roadmap Map view: the pure date math behind the timeline (range, lanes,
 * where each item sits, the trajectory summary). Days are whole UTC day
 * numbers so a YYYY-MM-DD never shifts with the viewer's timezone;
 * timestamps (created_at, done_at) are read as the viewer's local date.
 */
import {
  STAGE_LABELS,
  todayIso,
  type RoadmapItem,
  type RoadmapStage,
} from "@/lib/roadmap";

const DAY_MS = 86_400_000;

/** YYYY-MM-DD -> whole day number. */
export function isoToDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Whole day number -> YYYY-MM-DD. */
export function dayToIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** A timestamp as the viewer's local calendar day. */
export function stampToDay(ts: string): number {
  return isoToDay(todayIso(new Date(ts)));
}

/** 0 = Monday ... 6 = Sunday. */
export function weekday(day: number): number {
  return (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
}

export function mondayOf(day: number): number {
  return day - weekday(day);
}

/** Short label for a day: "Nov 12". */
export function dayLabel(day: number): string {
  return new Date(day * DAY_MS).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export const LOOKBACK_DAYS = 14;
export const LOOKAHEAD_DAYS = 12 * 7;

export interface MapRange {
  /** First day shown (a Monday). */
  start: number;
  /** Day after the last day shown (a Monday). */
  end: number;
  days: number;
}

/**
 * Two weeks back to twelve weeks ahead, stretched to cover every open
 * item's target (an old overdue one, a far-off one) with a week of margin.
 */
export function mapRange(items: RoadmapItem[], today: number): MapRange {
  let lo = today - LOOKBACK_DAYS;
  let hi = today + LOOKAHEAD_DAYS;
  for (const i of items) {
    if (i.stage === "done" || !i.target_date) continue;
    const t = isoToDay(i.target_date);
    lo = Math.min(lo, t - 7);
    hi = Math.max(hi, t + 14);
  }
  const start = mondayOf(lo);
  const end = mondayOf(hi) + 7;
  return { start, end, days: end - start };
}

/** Where an item sits on the map; null = open with no date (unscheduled). */
export type ItemSpan =
  | {
      kind: "scheduled";
      /** Bar start: when it was added (never after the target). */
      from: number;
      target: number;
      /** Set when the target has passed: the late stretch runs to today. */
      overdueTo: number | null;
    }
  | { kind: "done"; from: number; at: number };

export function itemSpan(item: RoadmapItem, today: number): ItemSpan | null {
  const added = stampToDay(item.created_at);
  if (item.stage === "done") {
    const at = item.done_at
      ? stampToDay(item.done_at)
      : item.target_date
        ? isoToDay(item.target_date)
        : stampToDay(item.updated_at);
    return { kind: "done", from: Math.min(added, at), at };
  }
  if (!item.target_date) return null;
  const target = isoToDay(item.target_date);
  return {
    kind: "scheduled",
    from: Math.min(added, target),
    target,
    overdueTo: target < today ? today : null,
  };
}

export type MapGroupBy = "stage" | "owner";

export interface MapLane {
  key: string;
  label: string;
  stage: RoadmapStage | null;
  rows: { item: RoadmapItem; span: ItemSpan }[];
}

const OPEN_STAGES: RoadmapStage[] = ["now", "next", "later"];

/** Sort key for a row: when it lands on the map. */
function rowDay(span: ItemSpan): number {
  return span.kind === "done" ? span.at : span.target;
}

/**
 * Lanes for the map plus the open items with no date. Done items show only
 * when they finished inside the range, so history doesn't swamp the plan.
 */
export function mapLanes(
  items: RoadmapItem[],
  groupBy: MapGroupBy,
  today: number,
  range: MapRange,
): { lanes: MapLane[]; unscheduled: RoadmapItem[] } {
  const unscheduled: RoadmapItem[] = [];
  const placed: { item: RoadmapItem; span: ItemSpan }[] = [];
  for (const item of items) {
    const span = itemSpan(item, today);
    if (!span) {
      unscheduled.push(item);
      continue;
    }
    if (span.kind === "done" && (span.at < range.start || span.at >= range.end)) continue;
    placed.push({ item, span });
  }
  placed.sort((a, b) => rowDay(a.span) - rowDay(b.span) || a.item.title.localeCompare(b.item.title));

  const stageRank = (s: RoadmapStage) => ["now", "next", "later", "done"].indexOf(s);
  unscheduled.sort(
    (a, b) =>
      stageRank(a.stage) - stageRank(b.stage) ||
      (a.priority === "high" ? 0 : 1) - (b.priority === "high" ? 0 : 1) ||
      a.position - b.position,
  );

  let lanes: MapLane[];
  if (groupBy === "stage") {
    lanes = [...OPEN_STAGES, "done" as RoadmapStage].map((stage) => ({
      key: stage,
      label: STAGE_LABELS[stage],
      stage,
      rows: placed.filter((r) => r.item.stage === stage),
    }));
  } else {
    const owners = Array.from(new Set(placed.map((r) => r.item.owner ?? ""))).sort((a, b) =>
      a === "" ? 1 : b === "" ? -1 : a.localeCompare(b),
    );
    lanes = owners.map((o) => ({
      key: o || "unassigned",
      label: o || "Unassigned",
      stage: null,
      rows: placed.filter((r) => (r.item.owner ?? "") === o),
    }));
  }
  return { lanes: lanes.filter((l) => l.rows.length > 0), unscheduled };
}

export interface Trajectory {
  overdue: number;
  thisWeek: number;
  next30: number;
  unscheduled: number;
  /** The soonest open item due today or later. */
  nextUp: RoadmapItem | null;
}

/** Counts for the strip above the map. "This week" runs to Sunday. */
export function trajectory(items: RoadmapItem[], today: number): Trajectory {
  const sunday = mondayOf(today) + 6;
  const out: Trajectory = { overdue: 0, thisWeek: 0, next30: 0, unscheduled: 0, nextUp: null };
  let nextDay = Infinity;
  for (const i of items) {
    if (i.stage === "done") continue;
    if (!i.target_date) {
      out.unscheduled++;
      continue;
    }
    const t = isoToDay(i.target_date);
    if (t < today) out.overdue++;
    else {
      if (t <= sunday) out.thisWeek++;
      if (t <= today + 30) out.next30++;
      if (t < nextDay) {
        nextDay = t;
        out.nextUp = i;
      }
    }
  }
  return out;
}
