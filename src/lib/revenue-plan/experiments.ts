/**
 * A/B tests for the April plan, one row per test: arm sizes, trial-to-paid,
 * 30-day revenue per trial net of refunds, the pre-registered stop rule and
 * status. PURE. experiments-data.ts reads arms out of rc_events.
 *
 * Arms come from the RevenueCat webhook payload stored in rc_events.raw:
 *  - an RC Experiment: raw.event.experiments[{experiment_id, experiment_variant}]
 *  - an app-set subscriber attribute: raw.event.subscriber_attributes[name].value
 * The attribute often lands after the trial-start event, so a user's arm is
 * the value on any of their events; a user seen with two values is dropped.
 *
 * Revenue: gross charges plus refunds (negative) within 30 days of the trial
 * start, read only once all of the arm's counted trials are 30+ days old
 * (about two weeks after the day-7 conversion, when refunds have posted).
 * Rules and arms come from the vault page wiki/revenue-100k-question.md.
 * Pinned by tests/experiments.test.ts.
 */
import { NET_FACTOR } from "./sources";
import { WINDOWS, assignCharges, trialRevenue, type Charge, type TrialStart } from "./value-per-trial";

export type ArmSource = { kind: "rc_experiment"; experimentId: string | null } | { kind: "attribute"; name: string };

export interface ArmDef {
  key: string;
  label: string;
  /** Values of the experiment variant or attribute that put a user in this arm. */
  values: string[];
  share: number;
  control?: boolean;
}

export interface StopRule {
  text: string;
  /** How the rule is scored; "none" = shown only (needs data rc_events lacks, or nothing pre-registered). */
  metric: "revPerEnrolled" | "trialToPaid" | "none";
  /** revPerEnrolled: stop when a test arm trails control by more than this share. */
  maxTrail?: number;
  /** trialToPaid: the lift (absolute) a test arm must show... */
  minLift?: number;
  /** ...once control has this many payer-mature trials. */
  minControlTrials?: number;
}

export interface ExperimentDef {
  id: string;
  title: string;
  lever: string;
  /** draft = designed, not running; nothing is read before `start`. */
  status: "draft" | "running" | "stopped";
  start: string | null; // YYYY-MM-DD
  end?: string | null;
  source: ArmSource;
  arms: ArmDef[];
  minTrialsPerArm: number;
  rule: StopRule;
  note?: string;
}

const TRIAL_COPY = "trial_notification_variant";

export const EXPERIMENTS: ExperimentDef[] = [
  {
    id: "price-plan",
    title: "Price and plan test",
    lever: "Lever 2 · RC Experiments, no release",
    status: "draft",
    start: null,
    source: { kind: "rc_experiment", experimentId: null },
    arms: [
      { key: "a", label: "Control (current offering)", values: ["a"], share: 0.5, control: true },
      { key: "b", label: "Test offering", values: ["b"], share: 0.5 },
    ],
    minTrialsPerArm: 1000,
    rule: {
      text: "Stop if the test arm trails by more than 5% on revenue per install at the 2-week read. Judge on 30-day revenue per trial net of refunds.",
      metric: "revPerEnrolled",
      maxTrail: 0.05,
    },
    note: "Candidate arms: yearly special $39.99 to $49.99; yearly $69.99 to $79.99; yearly as default with no trial on monthly; 14-day annual trial. Set experimentId and start when the RC experiment launches. The Jan 15 checkpoint needs +10% revenue per trial here.",
  },
  {
    id: "trial-save",
    title: "Trial-window save (80/20 holdout)",
    lever: "Lever 4 · release",
    status: "draft",
    start: null,
    source: { kind: "attribute", name: TRIAL_COPY },
    arms: [
      { key: "holdout", label: "Holdout (no reminders)", values: ["holdout"], share: 0.2, control: true },
      { key: "save", label: "Shot-day reminder + day-1/2 pushes", values: ["companion_focused", "emotional_appeal", "shot_day"], share: 0.8 },
    ],
    minTrialsPerArm: 1500,
    rule: {
      text: "Stop if there's no lift of at least 2pp in trial-to-paid after ~1,500 trials in the holdout arm.",
      metric: "trialToPaid",
      minLift: 0.02,
      minControlTrials: 1500,
    },
    note: "Needs the app to write trial_notification_variant = holdout for 20% of new trials.",
  },
  {
    id: "onboarding-intake",
    title: "Onboarding intake + commitment screen",
    lever: "Lever 3 · release, 50/50 flag",
    status: "draft",
    start: null,
    source: { kind: "attribute", name: "onboarding_intake_variant" },
    arms: [
      { key: "control", label: "Current onboarding", values: ["control"], share: 0.5, control: true },
      { key: "intake", label: "Intake + commitment", values: ["intake"], share: 0.5 },
    ],
    minTrialsPerArm: 1000,
    rule: {
      text: "Stop if install-to-trial falls more than 10% with no gain in install-to-paid. Needs installs per arm (Mixpanel), so it is shown, not scored.",
      metric: "none",
    },
  },
  {
    id: "trial-copy",
    title: "Trial notification copy (running since July)",
    lever: "Reference · app attribute",
    status: "running",
    start: "2026-07-09",
    source: { kind: "attribute", name: TRIAL_COPY },
    arms: [
      { key: "companion", label: "companion_focused", values: ["companion_focused"], share: 0.5, control: true },
      { key: "emotional", label: "emotional_appeal", values: ["emotional_appeal"], share: 0.5 },
    ],
    minTrialsPerArm: 500,
    rule: { text: "Nothing was pre-registered; shown so the arm math can be checked on real data.", metric: "none" },
  },
];

export interface ArmRead {
  key: string;
  label: string;
  control: boolean;
  share: number;
  trials: number;
  /** Trials 14+ days old: the trial-to-paid base. */
  payerTrials: number;
  payers: number;
  trialToPaid: number | null;
  /** Trials 30+ days old: the revenue base. */
  revTrials: number;
  /** Gross charges + refunds within 30 days, per trial. */
  rev30PerTrial: number | null;
  net30PerTrial: number | null;
  /** Revenue per enrolled user, as an index: arm revenue / arm share (comparable across arms only). */
  revPerEnrolled: number | null;
  /** Versus control: relative for revenue, absolute for trial-to-paid. */
  revLift: number | null;
  enrolledLift: number | null;
  paidLiftPp: number | null;
}

export type ExperimentStatus = "draft" | "no_data" | "collecting" | "stop" | "pass" | "ready" | "observing";

export interface ExperimentRead {
  def: ExperimentDef;
  arms: ArmRead[];
  unassigned: number;
  status: ExperimentStatus;
  message: string;
  /** Best test arm's 30-day revenue-per-trial lift (the Jan 15 pricing checkpoint). */
  bestRevLift: number | null;
}

const DAY_MS = 86_400_000;

/**
 * Score one experiment. `armByUser` maps app_user_id to the variant/attribute
 * value ("" for users seen with conflicting values). `charges` must include
 * refunds as negative charges.
 */
export function readExperiment(
  def: ExperimentDef,
  trials: TrialStart[],
  armByUser: Map<string, string>,
  charges: Charge[],
  now: Date,
): ExperimentRead {
  const blank = (status: ExperimentStatus, message: string): ExperimentRead => ({ def, arms: [], unassigned: 0, status, message, bestRevLift: null });
  if (def.status === "draft" || !def.start) return blank("draft", "Not started. The arms and stop rule below are pre-registered.");

  const startMs = Date.parse(`${def.start}T00:00:00Z`);
  const endMs = def.end ? Date.parse(`${def.end}T00:00:00Z`) + DAY_MS : Infinity;
  const inWindow = trials.filter((t) => Date.parse(t.at) >= startMs && Date.parse(t.at) < endMs);
  const byTrial = assignCharges(inWindow, charges);
  const nowMs = now.getTime();

  const reads: ArmRead[] = def.arms.map((a) => ({
    key: a.key,
    label: a.label,
    control: !!a.control,
    share: a.share,
    trials: 0,
    payerTrials: 0,
    payers: 0,
    trialToPaid: null,
    revTrials: 0,
    rev30PerTrial: null,
    net30PerTrial: null,
    revPerEnrolled: null,
    revLift: null,
    enrolledLift: null,
    paidLiftPp: null,
  }));
  const revSum = new Map<string, number>();
  let unassigned = 0;
  for (const t of inWindow) {
    const v = t.userId ? armByUser.get(t.userId) : undefined;
    const i = v ? def.arms.findIndex((a) => a.values.includes(v)) : -1;
    if (i < 0) {
      unassigned++;
      continue;
    }
    const r = reads[i];
    r.trials++;
    const age = (nowMs - Date.parse(t.at)) / DAY_MS;
    const rev = trialRevenue(t, byTrial.get(t.otx) ?? []);
    if (age >= WINDOWS.payer) {
      r.payerTrials++;
      if (rev.first) r.payers++;
    }
    if (age >= WINDOWS.d30) {
      r.revTrials++;
      revSum.set(r.key, (revSum.get(r.key) ?? 0) + rev.rev30);
    }
  }
  for (const r of reads) {
    r.trialToPaid = r.payerTrials ? r.payers / r.payerTrials : null;
    const sum = revSum.get(r.key) ?? 0;
    r.rev30PerTrial = r.revTrials ? sum / r.revTrials : null;
    r.net30PerTrial = r.rev30PerTrial == null ? null : r.rev30PerTrial * NET_FACTOR;
    r.revPerEnrolled = r.revTrials ? sum / r.share : null;
  }
  const ctrl = reads.find((r) => r.control) ?? reads[0];
  for (const r of reads) {
    if (r === ctrl) continue;
    if (r.rev30PerTrial != null && ctrl.rev30PerTrial) r.revLift = r.rev30PerTrial / ctrl.rev30PerTrial - 1;
    if (r.revPerEnrolled != null && ctrl.revPerEnrolled) r.enrolledLift = r.revPerEnrolled / ctrl.revPerEnrolled - 1;
    if (r.trialToPaid != null && ctrl.trialToPaid != null) r.paidLiftPp = r.trialToPaid - ctrl.trialToPaid;
  }
  const tests = reads.filter((r) => r !== ctrl);
  const lifts = tests.map((r) => r.revLift).filter((x): x is number => x != null);
  const bestRevLift = lifts.length ? Math.max(...lifts) : null;
  const out = (status: ExperimentStatus, message: string): ExperimentRead => ({ def, arms: reads, unassigned, status, message, bestRevLift });

  if (reads.every((r) => r.trials === 0)) return out("no_data", "Started, but no trial carries an arm yet. Check that the app or RC writes the arm.");
  const rule = def.rule;
  if (rule.metric === "trialToPaid") {
    if (ctrl.payerTrials < (rule.minControlTrials ?? def.minTrialsPerArm)) {
      return out("collecting", `${ctrl.payerTrials} of ${rule.minControlTrials ?? def.minTrialsPerArm} control trials are 14+ days old.`);
    }
    const fail = tests.find((r) => r.paidLiftPp == null || r.paidLiftPp < (rule.minLift ?? 0));
    return fail
      ? out("stop", `${fail.label} lifts trial-to-paid ${pp(fail.paidLiftPp)}, under the ${pp(rule.minLift ?? 0)} needed: stop.`)
      : out("pass", `Trial-to-paid lift ${tests.map((r) => pp(r.paidLiftPp)).join(", ")} clears ${pp(rule.minLift ?? 0)}.`);
  }
  const short = reads.find((r) => r.revTrials < def.minTrialsPerArm);
  if (rule.metric === "revPerEnrolled") {
    // The 2-week read can stop a losing arm before the full sample.
    const losing = tests.find((r) => r.enrolledLift != null && r.revTrials >= 200 && r.enrolledLift < -(rule.maxTrail ?? 0));
    if (losing) return out("stop", `${losing.label} trails control by ${pct(-losing.enrolledLift!)} on revenue per install: stop.`);
    if (short) return out("collecting", `${short.label}: ${short.revTrials} of ${def.minTrialsPerArm} trials are 30+ days old.`);
    return out("ready", `Full sample. Best arm ${bestRevLift == null ? "n/a" : signedPct(bestRevLift)} on 30-day revenue per trial.`);
  }
  if (short) return out("collecting", `${short.label}: ${short.revTrials} of ${def.minTrialsPerArm} trials are 30+ days old.`);
  return out("observing", `No scored rule. Best arm ${bestRevLift == null ? "n/a" : signedPct(bestRevLift)} on 30-day revenue per trial.`);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const signedPct = (x: number) => `${x >= 0 ? "+" : "−"}${pct(Math.abs(x))}`;
const pp = (x: number | null) => (x == null ? "n/a" : `${x >= 0 ? "+" : "−"}${(Math.abs(x) * 100).toFixed(1)}pp`);

/** A user's arm from all their events: one value, or "" when they carry two. */
export function armsFromEvents(rows: { userId: string | null; value: string | null }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.userId || !r.value) continue;
    const prev = out.get(r.userId);
    if (prev === undefined) out.set(r.userId, r.value);
    else if (prev !== r.value) out.set(r.userId, "");
  }
  return out;
}

/** The variant for one RC experiment out of raw.event.experiments. */
export function rcVariant(experiments: unknown, experimentId: string): string | null {
  if (!Array.isArray(experiments)) return null;
  for (const e of experiments) {
    if (e && typeof e === "object" && (e as Record<string, unknown>).experiment_id === experimentId) {
      const v = (e as Record<string, unknown>).experiment_variant;
      return typeof v === "string" ? v : null;
    }
  }
  return null;
}
