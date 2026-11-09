/**
 * Server side of the Experiments tab's RevenueCat link: read every RC
 * Experiment once, report live status for entries that name one, and move
 * those entries along when RC has (rules: rcSyncPatch in experiment-log.ts).
 * Runs on every GET /api/experiments and once a day from the RevenueCat cron,
 * so an entry follows RC even when nobody opens the tab.
 */
import { spGet, spPatch } from "@/lib/support/db";
import { fetchExperiments, revenueCatConfigured } from "@/lib/vendors/revenuecat";
import { rcSyncPatch, type ExperimentEntry, type RcExperimentState } from "@/lib/experiment-log";

export interface RcSyncResult {
  entries: ExperimentEntry[];
  rc: Record<string, RcExperimentState>;
  rcError: string | null;
  /** Entries this call moved, with what changed. */
  synced: { id: string; title: string; patch: Record<string, unknown> }[];
}

export async function loadAndSyncExperimentLog(): Promise<RcSyncResult> {
  let entries = await spGet<ExperimentEntry[]>("experiment_log?select=*&limit=1000");
  const wanted = new Set(entries.map((e) => e.rc_experiment_id).filter((x): x is string => !!x));
  const rc: Record<string, RcExperimentState> = {};
  const synced: RcSyncResult["synced"] = [];
  if (wanted.size === 0) return { entries, rc, rcError: null, synced };
  if (!revenueCatConfigured()) return { entries, rc, rcError: "RevenueCat key not configured", synced };

  try {
    for (const x of await fetchExperiments()) {
      if (!wanted.has(x.id)) continue;
      rc[x.id] = {
        id: x.id,
        status: x.status,
        started_at: x.started_at ?? null,
        stopped_at: x.stopped_at ?? null,
        enrollment_percentage: x.enrollment_percentage ?? null,
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      entries,
      rc: {},
      rcError: /experiments:read/.test(msg)
        ? "The RevenueCat API key can't read experiments (needs the experiments:read permission)"
        : msg.slice(0, 200),
      synced,
    };
  }

  // Move entries along; a failed write leaves the entry as it was.
  const next: ExperimentEntry[] = [];
  for (const e of entries) {
    const state = e.rc_experiment_id ? rc[e.rc_experiment_id] : undefined;
    const patch = state ? rcSyncPatch(e, state) : null;
    if (!patch) {
      next.push(e);
      continue;
    }
    try {
      const [updated] = await spPatch<ExperimentEntry>(`experiment_log?id=eq.${e.id}`, {
        ...patch,
        updated_at: new Date().toISOString(),
      });
      next.push(updated ?? e);
      synced.push({ id: e.id, title: e.title, patch });
    } catch {
      next.push(e);
    }
  }
  entries = next;
  return { entries, rc, rcError: null, synced };
}
