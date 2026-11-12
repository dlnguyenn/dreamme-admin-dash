/**
 * Experiments, read for a founder: what is running, what it is doing, and
 * what needs a person. Pure rules over three inputs — our own log
 * (experiment_log), RevenueCat's live state, and RevenueCat's per-variant
 * results — so the weekly email, the Overview panel and the tests all agree.
 *
 * The problem this solves: the log holds every test AND every shipped change
 * together, newest first. Twenty rows of mixed kinds and statuses say nothing
 * about which one is waiting on a decision. Here a row lands in exactly one
 * state, and only a row that needs a person carries `attention`.
 *
 * Nothing in this file fetches. Inputs come from experiment-log-sync.ts (our
 * log plus RC state) and vendors/revenuecat.ts (results).
 */
import {
  daysRunning,
  type ExperimentEntry,
  type ExperimentKind,
  type RcExperimentState,
} from "@/lib/experiment-log";

/** A test that has been running this long with no end date is drifting. */
export const LONG_RUN_DAYS = 60;
/** A draft older than this was probably abandoned. */
export const STALE_DRAFT_DAYS = 14;
/** At or beyond this (or its mirror below), RevenueCat's call is firm enough to act on. */
export const CALL_IT_CHANCE = 0.95;

export type ExperimentState =
  /** Waiting on a person: ready to call, ended without a result, or never started. */
  | "needs_decision"
  /** Running with enough data to watch. */
  | "reading"
  /** Running, too little data to mean anything yet. */
  | "too_early"
  /** Agreed but not running yet. */
  | "not_started"
  /** Done and written down, or shipped to everyone. */
  | "settled";

export type AttentionLevel = "critical" | "warning";

export interface ExperimentAttention {
  level: AttentionLevel;
  /** What is wrong, in one sentence. */
  why: string;
  /** The next move, addressed to the reader. */
  action: string;
}

/** One running test's numbers, already reduced from RevenueCat's results payload. */
export interface RcReadout {
  /** Customers enrolled in each arm. */
  customers: { a: number | null; b: number | null };
  /** Trials started in each arm. */
  trialsStarted: { a: number | null; b: number | null };
  /** Trial-start rate per arm, as a percentage, and B's change against A. */
  startRate: { a: number | null; b: number | null; changePct: number | null };
  /** Money per enrolled customer so far, per arm. Zero for weeks on a 7-day trial. */
  ltvPerCustomer: { a: number | null; b: number | null };
  /** RevenueCat's probability that B beats A on the trial-start rate, 0 to 1. */
  chanceToWin: number | null;
  chanceToWinStatus: "ok" | "insufficient_data" | "unavailable";
}

export interface ExperimentHealth {
  id: string;
  title: string;
  kind: ExperimentKind;
  area: string;
  state: ExperimentState;
  /** Where it is, in a few words: "Day 2", "Ready to call", "Starts Nov 16". */
  stage: string;
  /** What it is doing, or why nothing can be said yet. One line. */
  reading: string;
  attention: ExperimentAttention | null;
  owner: string | null;
  days: number | null;
  rcId: string | null;
  /** For a shipped change: the before-and-after reading, or why there is none. */
  watch: string | null;
  /** True when that reading is only "too early to say". */
  watchEarly: boolean;
}

export interface HealthInputs {
  entries: ExperimentEntry[];
  /** RevenueCat live state, keyed by rc_experiment_id (from the existing sync). */
  rc: Record<string, RcExperimentState>;
  /** Reduced results, keyed by rc_experiment_id. Missing is fine. */
  readouts: Record<string, RcReadout>;
  /** Whether RevenueCat could be reached at all; null when it could. */
  rcError: string | null;
  /** Today as an Eastern YYYY-MM-DD, the same day boundary as the rest of the dash. */
  today: string;
  /** For a shipped change, its before-and-after line, keyed by entry id. */
  watches?: Record<string, { line: string; early: boolean } | null>;
}

function pct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}

function daysBetween(fromIso: string, today: string): number | null {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

/**
 * The one line that says whether a running test is doing anything. Prefers
 * RevenueCat's own numbers; falls back to the metric we said we would watch,
 * and says so plainly when there isn't one.
 */
/** Ends a sentence, unless it already ends itself (a clipped one ends in an ellipsis). */
const dot = (s: string) => (s.endsWith("…") || s.endsWith(".") ? s : `${s}.`);

/** First sentence, short enough to stay one or two lines in a panel row. */
function firstSentence(text: string, max = 100): string {
  // A full stop only ends a sentence when whitespace or the end follows it,
  // otherwise "$9.99" and "retain_monthly_50_3m: 7.99" lose their decimals.
  const one = text.trim().split("\n")[0].split(/\.(?:\s|$)/)[0].trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

function readingFor(e: ExperimentEntry, r: RcReadout | undefined): string {
  if (r && r.startRate.a != null && r.startRate.b != null) {
    const arms = `trial starts ${pct(r.startRate.b)} against ${pct(r.startRate.a)}`;
    const sizes =
      r.customers.a != null && r.customers.b != null ? ` on ${r.customers.a + r.customers.b} people` : "";
    if (r.chanceToWinStatus === "ok" && r.chanceToWin != null) {
      const who = r.chanceToWin >= 0.5 ? "the new one" : "the current one";
      const chance = Math.round((r.chanceToWin >= 0.5 ? r.chanceToWin : 1 - r.chanceToWin) * 100);
      return `${arms}${sizes}. ${chance}% chance ${who} wins.`;
    }
    return `${arms}${sizes}. Too early to call.`;
  }
  const metric = firstSentence(e.primary_metric);
  // Only a running test can be missing a read. One that has not started is
  // allowed to be an idea, so it says what the idea is instead of complaining.
  if (e.status === "running") {
    return metric ? `No read yet. Watching: ${dot(metric)}` : "No metric was recorded, so there is nothing to read it against.";
  }
  if (metric) return `Will watch: ${dot(metric)}`;
  const idea = firstSentence(e.hypothesis);
  return idea ? dot(idea) : "";
}

/**
 * The first rule that fires wins, worst first. Every rule names the move, not
 * just the problem: this list is read on a Sunday morning, not debugged.
 */
function attentionFor(
  e: ExperimentEntry,
  rc: RcExperimentState | undefined,
  r: RcReadout | undefined,
  inputs: HealthInputs,
): ExperimentAttention | null {
  const { today, rcError } = inputs;
  // A decided entry is a call a person already made, after the fact. Nothing
  // here reopens it (the same exemption rcSyncPatch makes).
  if (e.status === "decided") return null;
  const hasResult = e.result.trim().length > 0;
  const ended = e.status === "stopped" || (!!e.end_date && e.end_date < today);

  // A named RevenueCat test that isn't in RevenueCat: the link is broken, so
  // nothing here is being tracked. Only trustworthy when RC answered.
  if (e.rc_experiment_id && !rc && !r && !rcError) {
    return {
      level: "critical",
      why: `Its RevenueCat test (${e.rc_experiment_id}) is no longer there.`,
      action: "Check whether it was deleted, and fix or clear the link.",
    };
  }

  // Over, and nobody wrote down what happened. This is how a test gets lost.
  if (ended && !hasResult && e.kind === "experiment") {
    return {
      level: "critical",
      why: e.status === "stopped" ? "It has stopped and no result is recorded." : "It is past its end date with no result.",
      action: "Write down what happened and what you decided.",
    };
  }

  // RevenueCat is confident. Acting now is worth more than more data.
  if (e.status === "running" && r && r.chanceToWinStatus === "ok" && r.chanceToWin != null) {
    const firm = r.chanceToWin >= CALL_IT_CHANCE || r.chanceToWin <= 1 - CALL_IT_CHANCE;
    if (firm) {
      const winner = r.chanceToWin >= 0.5 ? "the new version" : "the current version";
      return {
        level: "warning",
        why: `RevenueCat now puts ${winner} ahead with ${Math.round((r.chanceToWin >= 0.5 ? r.chanceToWin : 1 - r.chanceToWin) * 100)}% confidence.`,
        action: "Call it: stop the test and keep the winner.",
      };
    }
  }

  // Agreed to start, and the date has passed.
  if ((e.status === "planned" || e.status === "draft") && e.start_date && e.start_date < today) {
    return {
      level: "warning",
      why: `It was due to start on ${e.start_date} and is still ${e.status}.`,
      action: "Start it, or move the date so the log tells the truth.",
    };
  }

  // Running with no metric can never be read, so it will quietly never end.
  if (e.status === "running" && !e.primary_metric.trim() && e.kind === "experiment") {
    return {
      level: "warning",
      why: "It is running with no primary metric.",
      action: "Record what it is meant to move, or stop it.",
    };
  }

  // Running forever with no end in sight. Tests only: a shipped change is
  // meant to run forever, so "81 days and no end date" is the normal state
  // for one and must not be dressed up as a decision.
  const days = daysRunning(e.start_date, e.end_date, today);
  if (e.kind === "experiment" && e.status === "running" && !e.end_date && days != null && days > LONG_RUN_DAYS) {
    return {
      level: "warning",
      why: `It has been running ${days} days with no end date.`,
      action: "Give it an end date, or call it now.",
    };
  }

  // A draft nobody came back to.
  if (e.status === "draft" && !e.start_date) {
    const age = daysBetween(e.created_at, today);
    if (age != null && age > STALE_DRAFT_DAYS) {
      return {
        level: "warning",
        why: `It has been a draft for ${age} days.`,
        action: "Plan it with a date, or delete it.",
      };
    }
  }

  return null;
}

function stateFor(e: ExperimentEntry, attention: ExperimentAttention | null, r: RcReadout | undefined): ExperimentState {
  if (e.status === "decided") return "settled";
  if (attention && (attention.level === "critical" || attention.action.startsWith("Call it"))) return "needs_decision";
  if (e.status === "running") {
    const reading = r != null && r.startRate.a != null && r.startRate.b != null;
    return reading || e.kind === "change" ? "reading" : "too_early";
  }
  if (e.status === "planned" || e.status === "draft") return "not_started";
  // stopped, with a result written (no attention fired above)
  return "settled";
}

function stageFor(e: ExperimentEntry, state: ExperimentState, today: string): string {
  const days = daysRunning(e.start_date, e.end_date, today);
  if (state === "not_started") return e.start_date ? `Starts ${e.start_date}` : "No date yet";
  if (e.status === "running") return days != null ? `Day ${days}` : "No start date";
  if (e.status === "stopped") return e.end_date ? `Ended ${e.end_date}` : "Ended";
  if (e.status === "decided") return "Decided";
  return "Running";
}

const STATE_RANK: Record<ExperimentState, number> = {
  needs_decision: 0,
  reading: 1,
  too_early: 2,
  not_started: 3,
  settled: 4,
};

/** Every entry, in the order a founder should read them. */
export function buildExperimentHealth(inputs: HealthInputs): ExperimentHealth[] {
  const out = inputs.entries.map((e) => {
    const rc = e.rc_experiment_id ? inputs.rc[e.rc_experiment_id] : undefined;
    const readout = e.rc_experiment_id ? inputs.readouts[e.rc_experiment_id] : undefined;
    const attention = attentionFor(e, rc, readout, inputs);
    const state = stateFor(e, attention, readout);
    return {
      id: e.id,
      title: e.title,
      kind: e.kind,
      area: e.area,
      state,
      stage: stageFor(e, state, inputs.today),
      reading: e.kind === "change" ? firstSentence(e.what_changed) || "Shipped to everyone." : readingFor(e, readout),
      attention,
      owner: e.owner,
      days: daysRunning(e.start_date, e.end_date, inputs.today),
      rcId: e.rc_experiment_id,
      watch: e.kind === "change" ? inputs.watches?.[e.id]?.line ?? null : null,
      watchEarly: e.kind === "change" ? inputs.watches?.[e.id]?.early ?? false : false,
    } satisfies ExperimentHealth;
  });
  return out.sort((a, b) => {
    const sr = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (sr !== 0) return sr;
    if (a.attention && b.attention && a.attention.level !== b.attention.level) {
      return a.attention.level === "critical" ? -1 : 1;
    }
    return (b.days ?? -1) - (a.days ?? -1);
  });
}

export interface ExperimentSummary {
  /** Tests (not shipped changes) that are running right now. */
  running: number;
  /** Entries waiting on a person. */
  needsYou: number;
  /** Agreed but not started. */
  notStarted: number;
  /** Shipped changes on the log, which need no decision. */
  changes: number;
  /** Tests settled with a result written down. */
  settled: number;
}

export function summarize(healths: ExperimentHealth[]): ExperimentSummary {
  const tests = healths.filter((h) => h.kind === "experiment");
  return {
    running: tests.filter((h) => h.state === "reading" || h.state === "too_early").length,
    needsYou: healths.filter((h) => h.attention != null).length,
    notStarted: tests.filter((h) => h.state === "not_started").length,
    changes: healths.filter((h) => h.kind === "change").length,
    settled: tests.filter((h) => h.state === "settled").length,
  };
}

/** "3 tests running, 1 needs you" — the line that goes at the top of everything. */
export function headline(s: ExperimentSummary): string {
  const tests = `${s.running} test${s.running === 1 ? "" : "s"} running`;
  if (s.needsYou === 0) return `${tests}, nothing waiting on you`;
  return `${tests}, ${s.needsYou} need${s.needsYou === 1 ? "s" : ""} you`;
}

/**
 * The weekly email. Plain text, shortest useful form: what needs a person,
 * then what is running and what it is doing, then one line proving the data
 * is still flowing (the point of the whole thing is peace of mind).
 */
export function digestText(
  healths: ExperimentHealth[],
  opts: { checkedAt: string; rcError: string | null; dashUrl: string },
): string {
  const s = summarize(healths);
  const lines: string[] = [headline(s) + ".", ""];

  const needs = healths.filter((h) => h.attention != null);
  if (needs.length) {
    lines.push("NEEDS YOU");
    for (const h of needs) {
      lines.push(`- ${h.title} (${h.stage})`);
      lines.push(`  ${h.attention!.why} ${h.attention!.action}`);
    }
    lines.push("");
  }

  const running = healths.filter((h) => h.kind === "experiment" && (h.state === "reading" || h.state === "too_early"));
  if (running.length) {
    lines.push("RUNNING");
    for (const h of running) lines.push(`- ${h.title} (${h.stage}). ${h.reading}`);
    lines.push("");
  }

  const soon = healths.filter((h) => h.kind === "experiment" && h.state === "not_started" && !h.attention);
  if (soon.length) {
    lines.push("NOT STARTED YET");
    for (const h of soon) lines.push(`- ${h.title} (${h.stage})`);
    lines.push("");
  }

  const watched = healths.filter((h) => h.kind === "change" && h.watch);
  const reading = watched.filter((h) => !h.watchEarly);
  const early = watched.filter((h) => h.watchEarly);
  if (reading.length) {
    lines.push("SHIPPED TO EVERYONE, BEING WATCHED");
    lines.push("(Everyone got these, so each is a before and after, not a test.)");
    for (const h of reading) {
      lines.push(`- ${h.title} (${h.stage})`);
      lines.push(`  ${h.watch}`);
    }
    lines.push("");
  }
  if (early.length) {
    lines.push(
      `Too new to read: ${early.map((h) => h.title).join("; ")}. Each needs about a week after it shipped.`,
    );
    lines.push("");
  }

  const quiet = s.changes - reading.length - early.length;
  if (quiet > 0 || s.settled) {
    const bits: string[] = [];
    const other = watched.length ? "other " : "";
    if (quiet > 0) bits.push(`${quiet} ${other}shipped change${quiet === 1 ? "" : "s"}`);
    if (s.settled) bits.push(`${s.settled} settled test${s.settled === 1 ? "" : "s"}`);
    lines.push(`For the record: ${bits.join(" and ")} on the log. No decision needed on those.`);
    lines.push("");
  }

  lines.push(
    rcErrorLine(opts.rcError) ?? `RevenueCat was last read ${opts.checkedAt}, and every test above is being followed automatically.`,
  );
  lines.push("");
  lines.push(`Full log: ${opts.dashUrl}/?tab=experiments`);
  return lines.join("\n");
}

function rcErrorLine(rcError: string | null): string | null {
  if (!rcError) return null;
  return `Heads up: RevenueCat could not be read this time (${rcError}), so the numbers above may be behind. Everything else still applies.`;
}

/** The weekly email's subject line. */
export function digestSubject(healths: ExperimentHealth[]): string {
  const s = summarize(healths);
  const needs = healths.filter((h) => h.attention != null);
  if (needs.length === 1) return `Experiments: ${needs[0].title} needs you`;
  if (needs.length > 1) return `Experiments: ${needs.length} need you`;
  return `Experiments: ${s.running} running, all quiet`;
}
