/**
 * Overview > Experiments: reads the newest row the experiment-digest cron
 * wrote (experiment_status), never RevenueCat. One row, so the panel costs
 * nothing per page load and can state how fresh it is.
 *
 * That freshness is the point. The panel exists so nobody has to wonder
 * whether tests are still being followed, which means a check that stopped
 * running has to be louder than anything it would have reported: see
 * `staleness` below and the alerts it feeds.
 */
import { sbGet } from "@/lib/revenue-plan/db";
import type { ExperimentAttention, ExperimentState, ExperimentSummary } from "@/lib/experiment-health";

/** The cron writes one of these per entry into the snapshot's `items`. */
export interface ExperimentItem {
  id: string;
  title: string;
  kind: "experiment" | "change";
  area: string;
  state: ExperimentState;
  stage: string;
  reading: string;
  attention: ExperimentAttention | null;
  days: number | null;
  rcId: string | null;
  /** For a shipped change: its before-and-after reading, when it has one. */
  watch?: string | null;
  /** True when that reading is only "too early to say". */
  watchEarly?: boolean;
}

export interface ExperimentsSection {
  /** When the cron last looked. */
  checkedAt: string;
  /** "2 tests running, 1 needs you". */
  headline: string;
  counts: ExperimentSummary;
  items: ExperimentItem[];
  /** Why the last check could not read RevenueCat, when it could not. */
  rcError: string | null;
  /** Whether the check itself is behind, and by how much. */
  staleness: { level: "fresh" | "late" | "stopped"; hours: number | null };
}

/** The check runs daily, so a day and a half of silence means it has stopped. */
export const STALE_AFTER_HOURS = 36;

export function staleness(checkedAt: string | null, now: Date): ExperimentsSection["staleness"] {
  if (!checkedAt) return { level: "stopped", hours: null };
  const ts = Date.parse(checkedAt);
  if (Number.isNaN(ts)) return { level: "stopped", hours: null };
  const hours = (now.getTime() - ts) / 3_600_000;
  if (hours > STALE_AFTER_HOURS) return { level: "stopped", hours };
  if (hours > 26) return { level: "late", hours };
  return { level: "fresh", hours };
}

interface StatusRow {
  checked_at: string;
  summary: { headline?: string; counts?: ExperimentSummary; items?: ExperimentItem[] } | null;
  rc_error: string | null;
}

const EMPTY_COUNTS: ExperimentSummary = {
  running: 0,
  needsYou: 0,
  notStarted: 0,
  changes: 0,
  settled: 0,
};

/** null when the table has no rows yet (the cron has never run). */
export async function fetchExperimentsSection(now = new Date()): Promise<ExperimentsSection | null> {
  const rows = await sbGet<StatusRow[]>(
    "internal",
    "experiment_status?select=checked_at,summary,rc_error&order=checked_at.desc&limit=1",
  );
  const row = rows?.[0];
  if (!row) return null;
  return {
    checkedAt: row.checked_at,
    headline: row.summary?.headline ?? "",
    counts: row.summary?.counts ?? EMPTY_COUNTS,
    items: row.summary?.items ?? [],
    rcError: row.rc_error,
    staleness: staleness(row.checked_at, now),
  };
}

export interface ExperimentUrgent {
  id: string;
  fingerprint: string;
  level: "critical" | "warning";
  title: string;
  detail: string;
}

/**
 * The subset that belongs in the top strip: the check having stopped, and
 * entries that need a person now. Softer warnings (no metric recorded, a long
 * run, an old draft) stay in the panel — the strip is for things that are
 * broken or waiting, not for everything the panel knows.
 */
export function experimentUrgents(section: ExperimentsSection | null): ExperimentUrgent[] {
  if (!section) {
    return [
      {
        id: "experiments-never-checked",
        fingerprint: "never",
        level: "warning",
        title: "Experiments have never been checked",
        detail: "The weekly experiment check has not run yet, so no test is being followed automatically.",
      },
    ];
  }
  const out: ExperimentUrgent[] = [];
  if (section.staleness.level === "stopped") {
    const hours = section.staleness.hours == null ? "a long time" : `${Math.round(section.staleness.hours)} hours`;
    out.push({
      id: "experiments-check-stopped",
      fingerprint: section.checkedAt,
      level: "critical",
      title: "The experiment check has stopped running",
      detail: `It last ran ${hours} ago and runs daily, so what the Experiments panel shows may be out of date.`,
    });
  }
  for (const item of section.items) {
    if (!item.attention) continue;
    const callIt = item.attention.action.startsWith("Call it");
    if (item.attention.level !== "critical" && !callIt) continue;
    out.push({
      id: `experiment-${item.id}`,
      fingerprint: `${item.state}:${item.attention.why}`,
      level: item.attention.level,
      title: item.title,
      detail: `${item.attention.why} ${item.attention.action}`,
    });
  }
  return out;
}
