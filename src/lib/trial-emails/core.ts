/**
 * Trial emails — pure rules (no I/O), unit-tested in tests/trial-emails.test.ts.
 *
 * Day-0 and day-1 emails to new App Store / Play trialists, half held out.
 * Design, copy and the reasoning behind every rule: vault
 * wiki/trial-email-test.md. Route: /api/cron/trial-emails.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const EXPERIMENT = "trial-email-v1";
/** Dan's own inbox. Test sends can only ever go here. */
export const TEST_RECIPIENT = "dan@dreamme.life";

export type Arm = "email" | "holdout";
export type EmailKind = "day0" | "day1";
export type Platform = "ios" | "android";
export type Cta = "food" | "shot" | "shot_day" | "side_effect" | "weight";
export const MOODS = ["great", "okay", "rough", "tired"] as const;
export type Mood = (typeof MOODS)[number];
export const isMood = (m: string | null | undefined): m is Mood => !!m && (MOODS as readonly string[]).includes(m);

export type TrialStatus = "active" | "auto_renew_off" | "converted" | "expired" | "refunded";

const H = 3_600_000;

// ------------------------------------------------------------------ arm --

/** 0-99 from sha256(app_user_id:experiment). Stable per person. */
export function bucketOf(appUserId: string, experiment = EXPERIMENT): number {
  const hex = createHash("sha256").update(`${appUserId}:${experiment}`).digest("hex").slice(0, 8);
  return parseInt(hex, 16) % 100;
}

export function armOf(bucket: number): Arm {
  return bucket < 50 ? "email" : "holdout";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRealUserId = (id: string | null | undefined): id is string => !!id && UUID_RE.test(id);

export function platformOf(store: string | null | undefined): Platform | null {
  if (store === "APP_STORE") return "ios";
  if (store === "PLAY_STORE") return "android";
  return null;
}

// -------------------------------------------------------------- windows --

/** Trials are assigned while they are under this old (catch-up window). */
export const ASSIGN_WINDOW_MS = 6 * H;

export interface SendWindow {
  kind: EmailKind;
  /** trial_start_at must be > from and <= to to send now */
  from: string;
  to: string;
  /** trial_start_at <= this and still unclaimed = the window was missed */
  missedBefore: string;
}

/**
 * Day 0: from trial start up to 6h later. Day 1: hours 24-30 after trial
 * start (the same clock time they signed up, a little before the hour-24-48
 * cancel band). Outside its window an email is never sent late; the row is
 * marked window_missed instead.
 */
export function sendWindows(now: Date): SendWindow[] {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  return [
    { kind: "day0", from: ago(6 * H), to: ago(0), missedBefore: ago(6 * H) },
    { kind: "day1", from: ago(30 * H), to: ago(24 * H), missedBefore: ago(30 * H) },
  ];
}

// ---------------------------------------------------------- trial status --

export interface RcEventLite {
  type: string;
  period_type: string | null;
  event_at: string;
  price_usd: number | string | null;
  cancel_reason: string | null;
}

/** Where the trial stands right now, from its own rc_events rows. */
export function trialStatus(events: RcEventLite[], trialStartAt: string): TrialStatus {
  const after = events
    .filter((e) => e.event_at >= trialStartAt)
    .sort((a, b) => a.event_at.localeCompare(b.event_at));
  if (after.some((e) => e.type === "CANCELLATION" && e.cancel_reason === "CUSTOMER_SUPPORT")) return "refunded";
  if (
    after.some(
      (e) =>
        e.period_type === "NORMAL" &&
        Number(e.price_usd ?? 0) > 0 &&
        ["RENEWAL", "PRODUCT_CHANGE", "INITIAL_PURCHASE"].includes(e.type),
    )
  )
    return "converted";
  if (after.some((e) => e.type === "EXPIRATION")) return "expired";
  let renewOff = false;
  for (const e of after) {
    if (e.type === "CANCELLATION") renewOff = true;
    if (e.type === "UNCANCELLATION") renewOff = false;
  }
  return renewOff ? "auto_renew_off" : "active";
}

// ------------------------------------------------------------- decision --

export interface UserFacts {
  email: string | null;
  displayName: string | null;
  companionName: string | null;
  journeyStage: string | null;
  language: string | null;
  suppressed: boolean;
  /** a meal logged since trial start */
  foodLogged: boolean;
  /** a meal logged on trial day 2 (20h+ after the start): the day-1 email's "today" */
  foodToday: boolean;
  /** a shot logged 10+ minutes after trial start (onboarding writes one for ~26% of trials around the paywall) */
  shotLogged: boolean;
  /** side effect logged since trial start */
  sideEffectLogged: boolean;
}

export type Decision =
  | { send: false; reason: string }
  | { send: true; cta: Cta; cancelled: boolean; aboutToStart: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Skip rules, then the one action to ask for (2026-11-13, Dan: "switch to
 * food", after wiki/app-analytics-breakdown-2026-11). Food first: food
 * scanning holds the steadiest gap in paid rate at equal active days (barcode
 * +12, photo +10.5 points) and food + medication together is 66% of payers,
 * while early shot logging moved nothing in the shot-day natural experiment.
 * Then medication: the shot (or setting a shot day), then a side effect.
 * Activated = food and medication both logged (day 1: food logged today), so
 * nothing is sent (Muir's exit rule). Trialists who already turned auto-renew
 * off still get the email, in its status-aware version.
 */
export function decide(kind: EmailKind, status: TrialStatus, u: UserFacts): Decision {
  if (status === "converted") return { send: false, reason: "converted" };
  if (status === "expired") return { send: false, reason: "expired" };
  if (status === "refunded") return { send: false, reason: "refunded" };
  if (!u.email || !EMAIL_RE.test(u.email)) return { send: false, reason: "no_email" };
  if (u.suppressed) return { send: false, reason: "unsubscribed" };
  if (u.language && !/^en\b/i.test(u.language)) return { send: false, reason: "not_english" };

  const aboutToStart = u.journeyStage === "about_to_start";
  const medLogged = u.shotLogged || u.sideEffectLogged;
  const medCta: Cta = !u.shotLogged ? (aboutToStart ? "shot_day" : "shot") : "side_effect";
  const food = kind === "day0" ? u.foodLogged : u.foodToday;
  if (food && medLogged) return { send: false, reason: "activated" };
  const cta: Cta = food ? medCta : "food";
  return { send: true, cta, cancelled: status === "auto_renew_off", aboutToStart };
}

/** Short label stored on the row, e.g. "day0:shot_day:active". */
export function variantLabel(kind: EmailKind, d: Extract<Decision, { send: true }>): string {
  return `${kind}:${d.cta}:${d.cancelled ? "renew_off" : "active"}`;
}

// ------------------------------------------------------------ name bits --

/** First name from display_name, or "there". Never echoes an address or junk. */
export function firstName(displayName: string | null | undefined): string {
  const raw = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!raw || raw.length > 20 || /[@\d<>{}[\]\\/]/.test(raw) || !/^\p{L}[\p{L}'’-]*$/u.test(raw)) return "there";
  return raw.charAt(0).toLocaleUpperCase("en-US") + raw.slice(1);
}

/** The user's own name for their fish (48% rename it), or "Sushi". */
export function fishName(companionName: string | null | undefined): string {
  const raw = (companionName ?? "").trim();
  if (!raw || raw.length > 18 || /[@<>{}[\]\\/]|https?:/i.test(raw) || !/^[\p{L}\p{N}][\p{L}\p{N} '’.!-]*$/u.test(raw)) {
    return "Sushi";
  }
  return raw;
}

/** "Tuesday, Nov 17" in the user's own day (US Eastern when unknown). */
export function trialEndLabel(trialStartAt: string, timeZone?: string | null): string {
  const end = new Date(new Date(trialStartAt).getTime() + 7 * 24 * H);
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "short", day: "numeric" };
  try {
    return end.toLocaleDateString("en-US", { ...opts, timeZone: timeZone || "America/New_York" });
  } catch {
    return end.toLocaleDateString("en-US", { ...opts, timeZone: "America/New_York" });
  }
}

// -------------------------------------------------------------- tokens --

/** What a signed link is for: a button click on day 0/1, or unsubscribe. */
export type LinkPurpose = EmailKind | "unsub";

function linkKey(): string {
  return process.env.TRIAL_EMAIL_LINK_SECRET || process.env.CRON_SECRET || "";
}

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function sign(payload: string, key: string): string {
  return createHmac("sha256", `trial-email-link:${key}`).update(payload).digest("base64url").slice(0, 22);
}

/** Opaque, signed, no personal data: the transaction id and the purpose. */
export function makeToken(originalTransactionId: string, purpose: LinkPurpose, key = linkKey()): string {
  if (!key) throw new Error("no link secret (TRIAL_EMAIL_LINK_SECRET or CRON_SECRET)");
  const payload = `${originalTransactionId}|${purpose}`;
  return `${b64url(payload)}.${sign(payload, key)}`;
}

export function readToken(
  token: string | null | undefined,
  key = linkKey(),
): { originalTransactionId: string; purpose: LinkPurpose } | null {
  if (!token || !key) return null;
  const [p, sig] = token.split(".");
  if (!p || !sig) return null;
  let payload: string;
  try {
    payload = Buffer.from(p, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const want = Buffer.from(sign(payload, key));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const [otid, purpose] = payload.split("|");
  if (!otid || !["day0", "day1", "unsub"].includes(purpose)) return null;
  return { originalTransactionId: otid, purpose: purpose as LinkPurpose };
}

// --------------------------------------------------------------- stats --

export interface ArmCounts {
  n: number;
  x: number;
}

/**
 * Difference in proportions (email minus holdout) with a 95% normal interval.
 * Null until both arms have at least 30 matured trials.
 */
export function diffWithCi(email: ArmCounts, holdout: ArmCounts) {
  if (email.n < 30 || holdout.n < 30) return null;
  const p1 = email.x / email.n;
  const p0 = holdout.x / holdout.n;
  const se = Math.sqrt((p1 * (1 - p1)) / email.n + (p0 * (1 - p0)) / holdout.n);
  const d = p1 - p0;
  return { email: p1, holdout: p0, diff: d, low: d - 1.96 * se, high: d + 1.96 * se };
}

/** Trials per arm needed to detect `lift` (absolute) at 5% two-sided, 80% power. */
export function perArmNeeded(base: number, lift: number): number {
  const p1 = base;
  const p2 = base + lift;
  const pbar = (p1 + p2) / 2;
  const za = 1.959964;
  const zb = 0.841621;
  const n = (za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / lift ** 2;
  return Math.ceil(n);
}

/**
 * Earliest date the 14-day read has `needed` matured trials per arm, given
 * the assignment pace so far (trials per arm per day). Null before 2 days of data.
 */
export function readDate(startedAt: string, now: Date, assignedPerArm: number, needed: number): string | null {
  const days = (now.getTime() - new Date(startedAt).getTime()) / (24 * H);
  if (days < 2 || assignedPerArm <= 0) return null;
  const pace = assignedPerArm / days;
  const fillDays = needed / pace;
  const d = new Date(new Date(startedAt).getTime() + (fillDays + 14) * 24 * H);
  return d.toISOString().slice(0, 10);
}
