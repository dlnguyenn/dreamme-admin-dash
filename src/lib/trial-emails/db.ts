/**
 * Trial emails — I/O. Internal Supabase (rc_events + our tables) through the
 * service-role helpers in lib/support/db; consumer Supabase (users, logs)
 * read-only, same as /api/cron/trial-pings. Email addresses are read at send
 * time and never stored, except in email_suppressions after an unsubscribe.
 */
import { spGet, spPatch, spPost } from "@/lib/support/db";
import { EXPERIMENT, type EmailKind, type RcEventLite } from "./core";

const CONSUMER_URL = process.env.CONSUMER_SUPABASE_URL ?? "";
const CONSUMER_KEY = process.env.CONSUMER_SERVICE_ROLE_KEY ?? "";

export const consumerConfigured = () => !!CONSUMER_URL && !!CONSUMER_KEY;

async function cGet<T>(path: string): Promise<T> {
  if (!consumerConfigured()) throw new Error("consumer Supabase not configured");
  const res = await fetch(`${CONSUMER_URL}/rest/v1/${path}`, {
    headers: { apikey: CONSUMER_KEY, Authorization: `Bearer ${CONSUMER_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`consumer ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

const inList = (ids: string[]) => `in.(${ids.map((x) => `"${x.replace(/"/g, "")}"`).join(",")})`;

// ---------------------------------------------------------------- config --

export interface TrialEmailConfig {
  enabled: boolean;
  started_at: string | null;
  stopped_at: string | null;
  experiment: string;
  updated_at: string;
}

export async function getConfig(): Promise<TrialEmailConfig | null> {
  const rows = await spGet<TrialEmailConfig[]>("trial_email_config?select=enabled,started_at,stopped_at,experiment,updated_at&limit=1");
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- trials --

export interface NewTrial {
  original_transaction_id: string;
  app_user_id: string;
  store: string;
  product_id: string | null;
  event_at: string;
}

export async function fetchNewTrials(sinceIso: string): Promise<NewTrial[]> {
  const q = new URLSearchParams({
    select: "original_transaction_id,app_user_id,store,product_id,event_at",
    type: "eq.INITIAL_PURCHASE",
    period_type: "eq.TRIAL",
    environment: "eq.PRODUCTION",
    store: "in.(APP_STORE,PLAY_STORE)",
    event_at: `gt.${sinceIso}`,
    order: "event_at.asc",
  });
  const rows = await spGet<NewTrial[]>(`rc_events?${q}`);
  // A trial can carry more than one INITIAL_PURCHASE row; keep the first.
  const seen = new Map<string, NewTrial>();
  for (const r of rows) if (r.original_transaction_id && !seen.has(r.original_transaction_id)) seen.set(r.original_transaction_id, r);
  return [...seen.values()];
}

/** app_user_ids that bought anything (any transaction) before `trial`. */
export async function priorBuyers(trials: NewTrial[]): Promise<Set<string>> {
  const ids = [...new Set(trials.map((t) => t.app_user_id))];
  if (!ids.length) return new Set();
  const rows = await spGet<{ app_user_id: string; original_transaction_id: string; event_at: string }[]>(
    `rc_events?select=app_user_id,original_transaction_id,event_at&app_user_id=${inList(ids)}&type=in.(INITIAL_PURCHASE,RENEWAL,NON_RENEWING_PURCHASE)&environment=eq.PRODUCTION`,
  );
  const out = new Set<string>();
  for (const t of trials) {
    if (rows.some((r) => r.app_user_id === t.app_user_id && r.original_transaction_id !== t.original_transaction_id && r.event_at < t.event_at)) {
      out.add(t.app_user_id);
    }
  }
  return out;
}

export async function trialEvents(otid: string): Promise<RcEventLite[]> {
  return spGet<RcEventLite[]>(
    `rc_events?select=type,period_type,event_at,price_usd,cancel_reason&original_transaction_id=eq.${encodeURIComponent(otid)}&order=event_at.asc`,
  );
}

// ----------------------------------------------------------------- users --

export interface ConsumerUser {
  id: string;
  email: string | null;
  display_name: string | null;
  companion_name: string | null;
  glp1_journey_stage: string | null;
  language: string | null;
  timezone: string | null;
}

export async function consumerUsers(ids: string[]): Promise<Map<string, ConsumerUser>> {
  if (!ids.length) return new Map();
  const rows = await cGet<ConsumerUser[]>(
    `users?select=id,email,display_name,companion_name,glp1_journey_stage,language,timezone&id=${inList(ids)}`,
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/** Has the user done each activation action (shot ever; side effect and weight since `since`)? */
export async function activity(userId: string, since: string) {
  const id = encodeURIComponent(userId);
  const s = encodeURIComponent(since);
  const [shots, fx, weights] = await Promise.all([
    cGet<unknown[]>(`injection_logs?select=id&user_id=eq.${id}&limit=1`),
    cGet<unknown[]>(`side_effects_log?select=id&user_id=eq.${id}&created_at=gte.${s}&limit=1`),
    cGet<unknown[]>(`body_log?select=id&user_id=eq.${id}&weight=not.is.null&created_at=gte.${s}&limit=1`),
  ]);
  return { shotLogged: shots.length > 0, sideEffectLogged: fx.length > 0, weightLogged: weights.length > 0 };
}

export async function isSuppressed(email: string): Promise<boolean> {
  const rows = await spGet<unknown[]>(`email_suppressions?select=email&email=eq.${encodeURIComponent(email.toLowerCase())}&limit=1`);
  return rows.length > 0;
}

export async function suppress(email: string, appUserId: string | null, reason = "unsubscribe") {
  await spPost("email_suppressions", [{ email: email.toLowerCase(), reason, source: EXPERIMENT, app_user_id: appUserId }], {
    onConflict: "email",
    resolution: "ignore",
  });
}

// ----------------------------------------------------------- assignments --

export interface AssignmentRow {
  original_transaction_id: string;
  experiment: string;
  app_user_id: string;
  arm: "email" | "holdout";
  bucket: number;
  platform: "ios" | "android";
  product_id: string | null;
  trial_start_at: string;
  assigned_at?: string;
  email_on_file: boolean | null;
  journey_stage: string | null;
  day0_claimed_at?: string | null;
  day0_sent_at?: string | null;
  day0_skip_reason?: string | null;
  day0_variant?: string | null;
  day1_claimed_at?: string | null;
  day1_sent_at?: string | null;
  day1_skip_reason?: string | null;
  day1_variant?: string | null;
  day0_first_click_at?: string | null;
  day1_first_click_at?: string | null;
  day1_mood?: string | null;
  clicks?: number;
  unsubscribed_at?: string | null;
}

/** Insert one assignment. False when this trial or this person is already in. */
export async function insertAssignment(row: AssignmentRow): Promise<boolean> {
  try {
    const out = await spPost<AssignmentRow>("trial_email_assignments", [row], {
      onConflict: "original_transaction_id",
      resolution: "ignore",
    });
    return out.length > 0;
  } catch (e) {
    // The (experiment, app_user_id) unique index: this person already has a row.
    if (e instanceof Error && /Supabase 409/.test(e.message)) return false;
    throw e;
  }
}

export async function assignedIds(otids: string[]): Promise<Set<string>> {
  if (!otids.length) return new Set();
  const rows = await spGet<{ original_transaction_id: string }[]>(
    `trial_email_assignments?select=original_transaction_id&original_transaction_id=${inList(otids)}`,
  );
  return new Set(rows.map((r) => r.original_transaction_id));
}

/** Email-arm rows whose `kind` email is unclaimed and whose trial started in (from, to]. */
export async function dueRows(kind: EmailKind, from: string, to: string): Promise<AssignmentRow[]> {
  return spGet<AssignmentRow[]>(
    `trial_email_assignments?select=*&experiment=eq.${EXPERIMENT}&arm=eq.email&${kind}_claimed_at=is.null&trial_start_at=gt.${encodeURIComponent(from)}&trial_start_at=lte.${encodeURIComponent(to)}`,
  );
}

/** Mark unclaimed email-arm rows whose window has passed. Returns how many. */
export async function markMissed(kind: EmailKind, before: string): Promise<number> {
  const now = new Date().toISOString();
  const rows = await spPatch<AssignmentRow>(
    `trial_email_assignments?experiment=eq.${EXPERIMENT}&arm=eq.email&${kind}_claimed_at=is.null&trial_start_at=lte.${encodeURIComponent(before)}`,
    { [`${kind}_claimed_at`]: now, [`${kind}_skip_reason`]: "window_missed" },
  );
  return rows.length;
}

/** Atomic claim: only one run can flip claimed_at from null. */
export async function claim(otid: string, kind: EmailKind): Promise<boolean> {
  const rows = await spPatch<AssignmentRow>(
    `trial_email_assignments?original_transaction_id=eq.${encodeURIComponent(otid)}&${kind}_claimed_at=is.null`,
    { [`${kind}_claimed_at`]: new Date().toISOString() },
  );
  return rows.length === 1;
}

export async function patchAssignment(otid: string, patch: Partial<AssignmentRow> | Record<string, unknown>) {
  await spPatch(`trial_email_assignments?original_transaction_id=eq.${encodeURIComponent(otid)}`, patch);
}

export async function getAssignment(otid: string): Promise<AssignmentRow | null> {
  const rows = await spGet<AssignmentRow[]>(
    `trial_email_assignments?select=*&original_transaction_id=eq.${encodeURIComponent(otid)}&limit=1`,
  );
  return rows[0] ?? null;
}

export async function listAssignments(): Promise<AssignmentRow[]> {
  const out: AssignmentRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await spGet<AssignmentRow[]>(
      `trial_email_assignments?select=arm,platform,trial_start_at,assigned_at,email_on_file,journey_stage,day0_sent_at,day0_skip_reason,day0_variant,day1_sent_at,day1_skip_reason,day1_variant,day0_first_click_at,day1_first_click_at,day1_mood,clicks,unsubscribed_at&experiment=eq.${EXPERIMENT}&order=trial_start_at.asc&limit=1000&offset=${offset}`,
    );
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

export interface ArmStatsRow {
  arm: "email" | "holdout";
  platform: "ios" | "android";
  assigned: number;
  email_on_file: number;
  matured_48h: number;
  cancelled_48h: number;
  matured_7d: number;
  cancelled_7d: number;
  matured_14d: number;
  paid_14d: number;
  refunded_14d: number;
}

export async function armStats(): Promise<ArmStatsRow[]> {
  const { SUPABASE_URL } = await import("@/lib/supabase");
  const key = process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/trial_email_arm_stats`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_experiment: EXPERIMENT }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`arm stats ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const rows = (await res.json()) as Record<string, unknown>[];
  return rows.map((r) => {
    const n = (k: string) => Number(r[k] ?? 0);
    return {
      arm: r.arm as "email" | "holdout",
      platform: r.platform as "ios" | "android",
      assigned: n("assigned"),
      email_on_file: n("email_on_file"),
      matured_48h: n("matured_48h"),
      cancelled_48h: n("cancelled_48h"),
      matured_7d: n("matured_7d"),
      cancelled_7d: n("cancelled_7d"),
      matured_14d: n("matured_14d"),
      paid_14d: n("paid_14d"),
      refunded_14d: n("refunded_14d"),
    };
  });
}
