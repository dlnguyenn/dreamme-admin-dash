/**
 * Experiments tab: one log of every test we run and every change we ship to
 * everyone, with what we expected, what happened and what we decided.
 *
 * Two kinds, kept visibly apart on the page:
 *  - "experiment": has a control group (an RC Experiment, a holdout, a split)
 *  - "change": shipped to everyone, so any read is a before/after read
 *
 * Shared types and the pure rules (labels, ordering, validation), so the API
 * routes and the page agree. Storage: experiment_log (migration 0105),
 * service-role only. Not to be confused with src/lib/revenue-plan/experiments.ts,
 * which computes the arm-level readouts shown on April Plan > Experiments.
 */

export type ExperimentKind = "experiment" | "change";
export type ExperimentStatus = "planned" | "draft" | "running" | "stopped" | "decided";
export type ExperimentArea =
  | "pricing"
  | "paywall"
  | "onboarding"
  | "ads"
  | "lifecycle"
  | "retention"
  | "attribution"
  | "other";

export const EXPERIMENT_KINDS: ExperimentKind[] = ["experiment", "change"];
export const EXPERIMENT_STATUSES: ExperimentStatus[] = ["planned", "draft", "running", "stopped", "decided"];
export const EXPERIMENT_AREAS: ExperimentArea[] = [
  "pricing",
  "paywall",
  "onboarding",
  "ads",
  "lifecycle",
  "retention",
  "attribution",
  "other",
];
export const EXPERIMENT_OWNERS = ["Dan", "David"];

export const KIND_LABELS: Record<ExperimentKind, string> = {
  experiment: "Experiment",
  change: "Change",
};

export const KIND_HINTS: Record<ExperimentKind, string> = {
  experiment: "Has a control group",
  change: "Shipped to everyone, no control group",
};

export const AREA_LABELS: Record<ExperimentArea, string> = {
  pricing: "Pricing",
  paywall: "Paywall",
  onboarding: "Onboarding",
  ads: "Ads",
  lifecycle: "Lifecycle",
  retention: "Retention",
  attribution: "Attribution",
  other: "Other",
};

/**
 * Status words read differently per kind: a change that is "running" is
 * simply live, one that is "stopped" ended or was rolled back, and "decided" means kept.
 */
export function statusLabel(kind: ExperimentKind, status: ExperimentStatus): string {
  if (kind === "change") {
    return { planned: "Planned", draft: "Draft", running: "Live", stopped: "Ended", decided: "Kept" }[status];
  }
  return { planned: "Planned", draft: "Draft", running: "Running", stopped: "Stopped", decided: "Decided" }[status];
}

export interface ExperimentEntry {
  id: string;
  title: string;
  kind: ExperimentKind;
  area: ExperimentArea;
  status: ExperimentStatus;
  hypothesis: string;
  /** What changed and for whom: platform, country, new or existing users. */
  what_changed: string;
  has_control: boolean;
  /** YYYY-MM-DD */
  start_date: string | null;
  end_date: string | null;
  primary_metric: string;
  result: string;
  decision: string;
  rc_experiment_id: string | null;
  /** Vault page, e.g. "wiki/pricing.md#first-price-test" */
  vault_page: string | null;
  /** PR, commit or any other link; free text, one per line. */
  links: string;
  handoff_id: string | null;
  owner: string | null;
  created_at: string;
  updated_at: string;
}

/** Fields a create or update may set. */
export const EDITABLE_FIELDS = [
  "title",
  "kind",
  "area",
  "status",
  "hypothesis",
  "what_changed",
  "has_control",
  "start_date",
  "end_date",
  "primary_metric",
  "result",
  "decision",
  "rc_experiment_id",
  "vault_page",
  "links",
  "handoff_id",
  "owner",
] as const;

const STATUS_RANK: Record<ExperimentStatus, number> = {
  running: 0,
  draft: 1,
  planned: 2,
  stopped: 3,
  decided: 4,
};

/**
 * Newest first by start date. Undated planned and draft entries come first,
 * since they're what's next; an undated entry that already ran (a change
 * whose start nobody recorded) goes last. Ties break on status, then on when
 * the entry was added.
 */
function sortKey(e: ExperimentEntry): string {
  if (e.start_date) return e.start_date;
  return e.status === "planned" || e.status === "draft" ? "9999-12-31" : "0000-01-01";
}

export function sortEntries(entries: ExperimentEntry[]): ExperimentEntry[] {
  return [...entries].sort((a, b) => {
    const ad = sortKey(a);
    const bd = sortKey(b);
    if (ad !== bd) return bd.localeCompare(ad);
    const sr = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (sr !== 0) return sr;
    return b.created_at.localeCompare(a.created_at);
  });
}

/** Why a pair of dates is refused, or null. */
export function dateRangeError(start: string | null | undefined, end: string | null | undefined): string | null {
  if (start && end && end < start) return "End date is before the start date";
  return null;
}

/** "Jun 29 – Jul 7, 2026", "since Sep 30, 2026", "Not started". */
export function dateRangeLabel(start: string | null, end: string | null): string {
  const fmt = (iso: string, withYear: boolean) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  if (!start && !end) return "No dates yet";
  if (start && !end) return `Since ${fmt(start, true)}`;
  if (!start && end) return `Until ${fmt(end!, true)}`;
  const sameYear = start!.slice(0, 4) === end!.slice(0, 4);
  return `${fmt(start!, !sameYear)} – ${fmt(end!, true)}`;
}

/** Days from start to end (or to `today` while it's still on). */
export function daysRunning(start: string | null, end: string | null, today: string): number | null {
  if (!start) return null;
  const stop = end ?? today;
  if (stop < start) return null;
  return Math.round((Date.parse(`${stop}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

/** RevenueCat dashboard link for an experiment id. */
export function rcExperimentUrl(id: string): string {
  return `https://app.revenuecat.com/projects/c9e74a6c/experiments/${encodeURIComponent(id)}`;
}

/** Live RevenueCat state for an entry, as returned by the API. */
export interface RcExperimentState {
  id: string;
  status: string;
  started_at: string | null;
  stopped_at: string | null;
  enrollment_percentage: number | null;
}

/**
 * What an entry should change to match its RevenueCat experiment, or null.
 * RC moves draft -> running -> stopped (paused in between leaves us alone):
 *  - RC running: a planned/draft entry becomes running, start date filled in.
 *  - RC stopped: a planned/draft/running entry becomes stopped, end date filled.
 * Dates are only filled when empty, so a hand-entered date wins, and a
 * "decided" entry is never touched: that's a human call made after the stop.
 */
export function rcSyncPatch(
  e: Pick<ExperimentEntry, "status" | "start_date" | "end_date">,
  rc: RcExperimentState,
): Partial<Pick<ExperimentEntry, "status" | "start_date" | "end_date">> | null {
  if (e.status === "decided") return null;
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
  const patch: Partial<Pick<ExperimentEntry, "status" | "start_date" | "end_date">> = {};
  const rcStatus = rc.status.toLowerCase();
  if (rcStatus === "running" || rcStatus === "paused") {
    if (rcStatus === "running" && (e.status === "planned" || e.status === "draft")) patch.status = "running";
    if (!e.start_date && rc.started_at) patch.start_date = day(rc.started_at);
  } else if (rcStatus === "stopped") {
    if (e.status !== "stopped") patch.status = "stopped";
    if (!e.start_date && rc.started_at) patch.start_date = day(rc.started_at);
    if (!e.end_date && rc.stopped_at) patch.end_date = day(rc.stopped_at);
  }
  // Never write an end before the start.
  const start = patch.start_date ?? e.start_date;
  const end = patch.end_date ?? e.end_date;
  if (start && end && end < start) delete patch.end_date;
  return Object.keys(patch).length ? patch : null;
}
