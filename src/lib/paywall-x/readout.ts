/**
 * Paywall X test readout (`paywall_close_x`). PURE: no env, no fetch.
 * data.ts reads the rows; tests/paywall-x.test.ts pins the rules.
 *
 * Denominator: everyone exposed, i.e. every `experiment_assignments` row for
 * the key in the consumer database (one per user, written when a
 * non-subscriber sees the onboarding paywall while the test is on). Their
 * outcomes come from `rc_events`, joined on app_user_id.
 *
 * Definitions (the page prints the same):
 *  - Exposure time = the assignment row's created_at. A trial counts for the
 *    user if it starts no earlier than 1 hour before that (TRIAL_LOOKBACK_MS:
 *    the row is written a moment after the paywall shows, and the clocks are
 *    a store's and the database's). The user's first such trial is used.
 *  - Trial started the same day = the trial's US/Eastern calendar day is the
 *    exposure's (the DAD counts days in Eastern). Read once that day is over.
 *  - Within 24 h = trial start < exposure + 24 h. Read once the user is 24 h
 *    past exposure.
 *  - Within 7 days = trial start < exposure + 7 x 24 h (168 h). Read once the
 *    user is 7 days past exposure. The DAD's "7-day = within 8 days" rule is
 *    about trial-to-charge (conversions land at 7.0-7.5 days), so it doesn't
 *    apply to exposure-to-trial.
 *  - A trialist is a user whose trial started within 7 days of exposure.
 *  - Auto-renew off within 24 h = a CANCELLATION on the user (other than a
 *    refund, CUSTOMER_SUPPORT, or a BILLING_ERROR) within 24 h of the trial
 *    start, even if they turned it back on later. Out of trialists 24 h+ past
 *    their trial start.
 *  - Converted to paid = the DAD's payer rule (value-per-trial.ts): a paid,
 *    non-consumable charge within 14 days of the trial start. Out of
 *    trialists 14+ days past their trial start.
 *  - Refunds = trialists with a CUSTOMER_SUPPORT cancellation after the trial
 *    start, to date (a count, not a rate: refunds keep arriving).
 *  - Revenue per exposed user at 14 / 30 days = gross price_usd of every
 *    charge (RENEWAL, INITIAL_PURCHASE, NON_RENEWING_PURCHASE with period
 *    NORMAL; refunds not deducted, as Value per trial) by the user from
 *    exposure to exposure + 14 / 30 days, divided by every exposed user that
 *    old, trialist or not. "Too early" until someone is that old.
 *  - Difference = close_x minus control, with a 95% normal interval
 *    (trial-emails' diffWithCi). Not shown until both arms have 30 users old
 *    enough for that window.
 *  - Sample ratio: expected 50/50 in both sources. Flagged as uneven when a
 *    two-sided binomial test gives p < 0.001 (|z| > 3.29), checked once 100+
 *    users are in.
 */
import { easternDate } from "@/lib/revenue-plan/dates";
import { armsFromEvents } from "@/lib/revenue-plan/experiments";
import { WINDOWS, trialRevenue, type Charge, type TrialStart } from "@/lib/revenue-plan/value-per-trial";
import { diffWithCi, perArmNeeded } from "@/lib/trial-emails/core";
import {
  ARMS,
  normalizeArm,
  normalizePlatform,
  normalizeSource,
  sourceFromSalt,
  type PaywallXArm,
  type PaywallXPlatform,
  type PaywallXSource,
} from "./shared";

const H = 3_600_000;
const DAY = 24 * H;

export const TRIAL_LOOKBACK_MS = H;
export const TRIAL_24H_MS = 24 * H;
export const TRIAL_7D_MS = 7 * DAY;
export const RENEW_OFF_MS = 24 * H;
export const PAYER_DAYS = WINDOWS.payer;
export const REV_DAYS = [14, 30] as const;
/** diffWithCi's own floor: both arms need this many users old enough. */
export const MIN_PER_ARM = 30;
export const SRM_MIN_USERS = 100;
export const SRM_ALPHA = 0.001;

/** Cancel reasons that are not the user turning auto-renew off. */
const NOT_RENEW_OFF = new Set(["CUSTOMER_SUPPORT", "BILLING_ERROR"]);

// ---- inputs ---------------------------------------------------------------

export interface AssignmentRow {
  appUserId: string;
  installId: string | null;
  variant: string | null;
  salt: string | null;
  platform: string | null;
  createdAt: string;
}

export interface CancelEvent {
  userId: string | null;
  otx: string | null;
  at: string;
  /** CANCELLATION or UNCANCELLATION */
  type: string;
  cancelReason: string | null;
}

/** One rc_events row carrying the RevenueCat attributes. */
export interface ArmTag {
  userId: string | null;
  at: string;
  variant: string | null;
  source: string | null;
}

export interface ReadoutInput {
  assignments: AssignmentRow[];
  trials: TrialStart[];
  /** Gross charges (positive), as fetchCharges returns them. */
  charges: Charge[];
  /** Refunds, as fetchRefunds returns them (negative amounts). */
  refunds: Charge[];
  cancels: CancelEvent[];
  tags: ArmTag[];
}

// ---- outputs --------------------------------------------------------------

/** x of n users old enough; `tooRecent` more are in the arm but too new to count. */
export interface Rate {
  n: number;
  x: number;
  rate: number | null;
  tooRecent: number;
}

export interface Money {
  /** Exposed users old enough for the window. */
  n: number;
  sum: number;
  perUser: number | null;
  tooRecent: number;
}

export interface ArmStats {
  exposed: number;
  trialSameDay: Rate;
  trial24h: Rate;
  trial7d: Rate;
  /** Trial within 7 days of exposure, counted as soon as it happens. */
  trialists: number;
  renewOff24h: Rate;
  paid14: Rate;
  refunded: number;
  rev14: Money;
  rev30: Money;
}

export type DiffMetric = "trialSameDay" | "trial24h" | "trial7d" | "renewOff24h" | "paid14";
export const DIFF_METRICS: DiffMetric[] = ["trialSameDay", "trial24h", "trial7d", "renewOff24h", "paid14"];

export interface DiffRead {
  metric: DiffMetric;
  ci: { diff: number; low: number; high: number } | null;
  verdict: "higher" | "lower" | "unclear" | "too_few";
  text: string;
}

export interface SrmRead {
  control: number;
  closeX: number;
  /** close_x share of the two arms. */
  share: number | null;
  z: number | null;
  p: number | null;
  state: "too_few" | "even" | "uneven";
  text: string;
}

export type SegmentSource = PaywallXSource | "all";
export type SegmentPlatform = PaywallXPlatform | "all";

export interface SegmentRead {
  key: string;
  source: SegmentSource;
  platform: SegmentPlatform;
  arms: Record<PaywallXArm, ArmStats>;
  diffs: Record<DiffMetric, DiffRead>;
  srm: SrmRead;
}

export type UserStatus = "no_trial" | "trial" | "auto_renew_off" | "paid" | "refunded";

export interface UserOutcome {
  appUserId: string;
  arm: PaywallXArm;
  source: PaywallXSource;
  platform: PaywallXPlatform;
  exposedAt: string;
  trialAt: string | null;
  /** Hours from exposure to trial start (can be slightly negative, see the lookback). */
  trialHoursAfter: number | null;
  status: UserStatus;
}

export interface DataChecks {
  /** Assignment rows whose variant is neither control nor close_x (left out). */
  unknownVariant: number;
  /** Exposed users who carry the RevenueCat arm attribute on any rc_event. */
  tagged: number;
  /** ...whose attribute disagrees with the exposure row (or carries both arms). */
  armMismatch: number;
  /** ...whose paywall_close_x_source attribute disagrees with the exposure row's salt. */
  sourceMismatch: number;
  /** RevenueCat says a user is in an arm, but there is no exposure row for them. */
  tagOnly: Record<PaywallXArm, number>;
}

export interface PaywallXReadout {
  generatedAt: string;
  state: "no_data" | "collecting" | "reading";
  message: string;
  firstExposure: string | null;
  lastExposure: string | null;
  exposed: number;
  segments: SegmentRead[];
  checks: DataChecks;
  /** Newest exposures first, at most RECENT_LIMIT. */
  recent: UserOutcome[];
  /** Users per arm a 2-point difference in 7-day trial rate needs (null until control has a 7-day rate). */
  need2pt: number | null;
}

export const RECENT_LIMIT = 50;

// ---- helpers --------------------------------------------------------------

const ms = (iso: string) => Date.parse(iso);

function groupBy<T>(rows: T[], key: (r: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

const rate = (x: number, n: number, tooRecent: number): Rate => ({ n, x, rate: n ? x / n : null, tooRecent });
const money = (sum: number, n: number, tooRecent: number): Money => ({ n, sum, perUser: n ? sum / n : null, tooRecent });

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf). */
function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Is the arm split even? Binomial test against 50/50 (normal approximation). */
export function sampleRatio(control: number, closeX: number): SrmRead {
  const n = control + closeX;
  const share = n ? closeX / n : null;
  if (n < SRM_MIN_USERS) {
    return { control, closeX, share, z: null, p: null, state: "too_few", text: `Too few users to check the split (${n} of ${SRM_MIN_USERS}).` };
  }
  const z = (closeX - n / 2) / Math.sqrt(n / 4);
  const p = 2 * (1 - phi(Math.abs(z)));
  const sharePct = `${(share! * 100).toFixed(1)}%`;
  if (p < SRM_ALPHA) {
    return {
      control,
      closeX,
      share,
      z,
      p,
      state: "uneven",
      text: `Uneven split: ${control} control vs ${closeX} close_x (${sharePct} close_x, expected 50%). A gap this big happens by chance less than 1 time in 1,000, so something is assigning or recording one arm more than the other. Fix that before reading the results.`,
    };
  }
  return { control, closeX, share, z, p, state: "even", text: `Split looks even: ${control} control vs ${closeX} close_x (${sharePct} close_x, expected 50%).` };
}

const DIFF_LABEL: Record<DiffMetric, string> = {
  trialSameDay: "trial the same day",
  trial24h: "trial within 24 h",
  trial7d: "trial within 7 days",
  renewOff24h: "auto-renew off within 24 h",
  paid14: "converted to paid",
};

const pts = (x: number) => `${x >= 0 ? "+" : "−"}${(Math.abs(x) * 100).toFixed(1)} pts`;

export function diffRead(metric: DiffMetric, closeX: Rate, control: Rate): DiffRead {
  const ci = diffWithCi({ n: closeX.n, x: closeX.x }, { n: control.n, x: control.x });
  if (!ci) {
    return {
      metric,
      ci: null,
      verdict: "too_few",
      text: `Too few to read: needs ${MIN_PER_ARM} users per arm old enough (now ${control.n} control, ${closeX.n} close_x).`,
    };
  }
  const range = `95% range ${pts(ci.low)} to ${pts(ci.high)}`;
  const out = { metric, ci: { diff: ci.diff, low: ci.low, high: ci.high } };
  if (ci.low > 0) return { ...out, verdict: "higher", text: `close_x ${pts(ci.diff)} on ${DIFF_LABEL[metric]}; ${range}, so higher than control.` };
  if (ci.high < 0) return { ...out, verdict: "lower", text: `close_x ${pts(ci.diff)} on ${DIFF_LABEL[metric]}; ${range}, so lower than control.` };
  return { ...out, verdict: "unclear", text: `close_x ${pts(ci.diff)} on ${DIFF_LABEL[metric]}; ${range}, so no clear difference yet.` };
}

// ---- per user ---------------------------------------------------------------

interface Exposure {
  appUserId: string;
  arm: PaywallXArm;
  source: PaywallXSource;
  platform: PaywallXPlatform;
  exposedAt: string;
}

interface Outcome extends UserOutcome {
  sameDay: { mature: boolean; hit: boolean };
  t24: { mature: boolean; hit: boolean };
  t7: { mature: boolean; hit: boolean };
  trialist: boolean;
  renewOff: { mature: boolean; hit: boolean };
  paid: { mature: boolean; hit: boolean };
  refunded: boolean;
  rev: Record<(typeof REV_DAYS)[number], { mature: boolean; sum: number }>;
}

function outcomeFor(
  e: Exposure,
  trials: TrialStart[],
  charges: Charge[],
  refunds: Charge[],
  cancels: CancelEvent[],
  nowMs: number,
  today: string,
): Outcome {
  const exp = ms(e.exposedAt);
  const age = nowMs - exp;
  const trial = trials.find((t) => ms(t.at) >= exp - TRIAL_LOOKBACK_MS) ?? null;
  const tMs = trial ? ms(trial.at) : null;
  const dt = tMs == null ? null : tMs - exp;
  const expDay = easternDate(exp);

  const trialist = dt != null && dt < TRIAL_7D_MS;
  const tAge = tMs == null ? 0 : nowMs - tMs;
  const after = <T extends { at: string }>(rows: T[]): T[] => (tMs == null ? [] : rows.filter((r) => ms(r.at) >= tMs));

  const renewOffHit =
    trialist &&
    cancels.some(
      (c) => c.type === "CANCELLATION" && !NOT_RENEW_OFF.has(c.cancelReason ?? "") && ms(c.at) >= tMs! && ms(c.at) < tMs! + RENEW_OFF_MS,
    );
  const paidHit = trialist && trialRevenue(trial!, after(charges)).first != null;
  const refunded = trialist && after(refunds).length > 0;

  const rev = {} as Outcome["rev"];
  for (const d of REV_DAYS) {
    const end = exp + d * DAY;
    rev[d] = {
      mature: age >= d * DAY,
      sum: charges.filter((c) => ms(c.at) >= exp - TRIAL_LOOKBACK_MS && ms(c.at) < end && c.priceUsd > 0).reduce((s, c) => s + c.priceUsd, 0),
    };
  }

  // Where the user stands now (for the recent list).
  let status: UserStatus = "no_trial";
  if (trial && tMs != null) {
    const evs = after(cancels).sort((a, b) => a.at.localeCompare(b.at));
    let off = false;
    for (const c of evs) {
      if (c.type === "CANCELLATION" && !NOT_RENEW_OFF.has(c.cancelReason ?? "")) off = true;
      if (c.type === "UNCANCELLATION") off = false;
    }
    const paidEver = after(charges).some((c) => c.priceUsd > 0);
    status = after(refunds).length ? "refunded" : paidEver ? "paid" : off ? "auto_renew_off" : "trial";
  }

  return {
    ...e,
    trialAt: trial?.at ?? null,
    trialHoursAfter: dt == null ? null : dt / H,
    status,
    sameDay: { mature: today > expDay, hit: trial != null && easternDate(trial.at) <= expDay },
    t24: { mature: age >= TRIAL_24H_MS, hit: dt != null && dt < TRIAL_24H_MS },
    t7: { mature: age >= TRIAL_7D_MS, hit: trialist },
    trialist,
    renewOff: { mature: trialist && tAge >= RENEW_OFF_MS, hit: renewOffHit },
    paid: { mature: trialist && tAge >= PAYER_DAYS * DAY, hit: paidHit },
    refunded,
    rev,
  };
}

function armStats(rows: Outcome[]): ArmStats {
  const r = (pick: (o: Outcome) => { mature: boolean; hit: boolean }, base: Outcome[]) => {
    const mature = base.filter((o) => pick(o).mature);
    return rate(mature.filter((o) => pick(o).hit).length, mature.length, base.length - mature.length);
  };
  const trialists = rows.filter((o) => o.trialist);
  const m = (d: (typeof REV_DAYS)[number]) => {
    const mature = rows.filter((o) => o.rev[d].mature);
    return money(
      mature.reduce((s, o) => s + o.rev[d].sum, 0),
      mature.length,
      rows.length - mature.length,
    );
  };
  return {
    exposed: rows.length,
    trialSameDay: r((o) => o.sameDay, rows),
    trial24h: r((o) => o.t24, rows),
    trial7d: r((o) => o.t7, rows),
    trialists: trialists.length,
    renewOff24h: r((o) => o.renewOff, trialists),
    paid14: r((o) => o.paid, trialists),
    refunded: trialists.filter((o) => o.refunded).length,
    rev14: m(14),
    rev30: m(30),
  };
}

const SOURCES: SegmentSource[] = ["all", "revenuecat", "split"];
const PLATFORMS: SegmentPlatform[] = ["all", "ios", "android", "other"];

export const segmentKey = (s: SegmentSource, p: SegmentPlatform) => `${s}/${p}`;

// ---- the readout -------------------------------------------------------------

export function buildPaywallXReadout(input: ReadoutInput, now: Date): PaywallXReadout {
  const nowMs = now.getTime();
  const today = easternDate(now);

  // One exposure per user: the earliest row (the table is unique per user; this guards a re-salt or a copy).
  const firstRow = new Map<string, AssignmentRow>();
  for (const a of [...input.assignments].sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    if (a.appUserId && !firstRow.has(a.appUserId)) firstRow.set(a.appUserId, a);
  }
  let unknownVariant = 0;
  const exposures: Exposure[] = [];
  for (const a of firstRow.values()) {
    const arm = normalizeArm(a.variant);
    if (!arm) {
      unknownVariant++;
      continue;
    }
    exposures.push({
      appUserId: a.appUserId,
      arm,
      source: sourceFromSalt(a.salt),
      platform: normalizePlatform(a.platform),
      exposedAt: a.createdAt,
    });
  }

  const trialsByUser = groupBy(input.trials, (t) => t.userId);
  for (const list of trialsByUser.values()) list.sort((a, b) => a.at.localeCompare(b.at));
  const chargesByUser = groupBy(input.charges, (c) => c.userId);
  const refundsByUser = groupBy(input.refunds, (c) => c.userId);
  const cancelsByUser = groupBy(input.cancels, (c) => c.userId);

  const outcomes = exposures.map((e) =>
    outcomeFor(
      e,
      trialsByUser.get(e.appUserId) ?? [],
      chargesByUser.get(e.appUserId) ?? [],
      refundsByUser.get(e.appUserId) ?? [],
      cancelsByUser.get(e.appUserId) ?? [],
      nowMs,
      today,
    ),
  );

  // RevenueCat's own record of the arm, from any of the user's events (it often lands after the trial start).
  const tagArm = armsFromEvents(input.tags.map((t) => ({ userId: t.userId, value: normalizeArm(t.variant) })));
  const tagSource = new Map<string, PaywallXSource>();
  for (const t of [...input.tags].sort((a, b) => a.at.localeCompare(b.at))) {
    const s = normalizeSource(t.source);
    if (t.userId && s) tagSource.set(t.userId, s);
  }
  const exposedIds = new Set(firstRow.keys());
  const checks: DataChecks = { unknownVariant, tagged: 0, armMismatch: 0, sourceMismatch: 0, tagOnly: { control: 0, close_x: 0 } };
  for (const e of exposures) {
    const t = tagArm.get(e.appUserId);
    if (t !== undefined) {
      checks.tagged++;
      if (t !== e.arm) checks.armMismatch++;
    }
    const s = tagSource.get(e.appUserId);
    if (s && s !== e.source) checks.sourceMismatch++;
  }
  for (const [user, arm] of tagArm) {
    if (!exposedIds.has(user) && (arm === "control" || arm === "close_x")) checks.tagOnly[arm]++;
  }

  const segments: SegmentRead[] = [];
  for (const source of SOURCES) {
    for (const platform of PLATFORMS) {
      const rows = outcomes.filter((o) => (source === "all" || o.source === source) && (platform === "all" || o.platform === platform));
      if (platform === "other" && rows.length === 0) continue;
      const arms = Object.fromEntries(ARMS.map((a) => [a, armStats(rows.filter((o) => o.arm === a))])) as Record<PaywallXArm, ArmStats>;
      const diffs = Object.fromEntries(DIFF_METRICS.map((m) => [m, diffRead(m, arms.close_x[m], arms.control[m])])) as Record<DiffMetric, DiffRead>;
      segments.push({ key: segmentKey(source, platform), source, platform, arms, diffs, srm: sampleRatio(arms.control.exposed, arms.close_x.exposed) });
    }
  }

  const all = segments.find((s) => s.key === "all/all")!;
  const sorted = [...outcomes].sort((a, b) => b.exposedAt.localeCompare(a.exposedAt));
  const ctrl7 = all.arms.control.trial7d;
  const need2pt = ctrl7.n >= MIN_PER_ARM && ctrl7.rate != null && ctrl7.rate + 0.02 < 1 ? perArmNeeded(ctrl7.rate, 0.02) : null;

  let state: PaywallXReadout["state"];
  let message: string;
  if (!outcomes.length) {
    state = "no_data";
    message =
      unknownVariant > 0
        ? `${unknownVariant} exposure rows, but none with a control or close_x arm. Check what the app writes in variant.`
        : "Nobody has been exposed yet. The test starts when the app_config row paywall_close_x is switched on; the first non-subscriber who sees the onboarding paywall after that shows up here.";
  } else if (all.diffs.trial24h.verdict === "too_few") {
    state = "collecting";
    message = `${outcomes.length} exposed so far. Too early to read: ${all.arms.control.trial24h.n} control and ${all.arms.close_x.trial24h.n} close_x users are 24 h past exposure, and a read needs ${MIN_PER_ARM} per arm.`;
  } else {
    state = "reading";
    const d = all.diffs.trial7d.verdict === "too_few" ? all.diffs.trial24h : all.diffs.trial7d;
    message = d.text;
  }
  if (all.srm.state === "uneven") message = `${all.srm.text} ${message}`;

  return {
    generatedAt: now.toISOString(),
    state,
    message,
    firstExposure: outcomes.length ? outcomes.reduce((m, o) => (o.exposedAt < m ? o.exposedAt : m), outcomes[0].exposedAt) : null,
    lastExposure: sorted[0]?.exposedAt ?? null,
    exposed: outcomes.length,
    segments,
    checks,
    recent: sorted.slice(0, RECENT_LIMIT).map((o) => ({
      appUserId: o.appUserId,
      arm: o.arm,
      source: o.source,
      platform: o.platform,
      exposedAt: o.exposedAt,
      trialAt: o.trialAt,
      trialHoursAfter: o.trialHoursAfter,
      status: o.status,
    })),
    need2pt,
  };
}
