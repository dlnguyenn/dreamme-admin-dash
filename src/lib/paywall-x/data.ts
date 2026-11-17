/**
 * Server side of the Paywall X test readout. Reads:
 *  - consumer Supabase `experiment_assignments` (key paywall_close_x): the
 *    exposed users, through the existing read-only consumer client
 *    (CONSUMER_SUPABASE_URL / CONSUMER_SERVICE_ROLE_KEY, already used by the
 *    April Plan source join, trial pings and the Support Inbox);
 *  - DreamMe Internal `rc_events`: trial starts, charges, refunds,
 *    cancellations and the RevenueCat attributes paywall_close_x_variant /
 *    paywall_close_x_source, with the same readers as Value per trial and
 *    April Plan > Experiments.
 * The rules are in readout.ts. Never import this from a client component.
 */
import { consumerConfigured, internalConfigured, MissingTableError, sbAll, sbGet } from "@/lib/revenue-plan/db";
import { easternDate, utcSinceForEasternDay } from "@/lib/revenue-plan/dates";
import { ARM_EVENT_TYPES, fetchRefunds } from "@/lib/revenue-plan/experiments-data";
import { fetchCharges, fetchTrialStarts } from "@/lib/revenue-plan/value-per-trial-data";
import { buildPaywallXReadout, type ArmTag, type AssignmentRow, type CancelEvent, type PaywallXReadout } from "./readout";
import {
  PAYWALL_X_EARLIEST_DAY,
  PAYWALL_X_KEY,
  normalizeArm,
  normalizePlatform,
  normalizeSource,
  sourceFromSalt,
  type PaywallXUserArm,
} from "./shared";

/** What the page needs to say when it can't read. Env var NAMES only, never values. */
export interface PaywallXSetup {
  missing: string[];
}

export function paywallXSetup(): PaywallXSetup {
  const missing: string[] = [];
  if (!consumerConfigured()) missing.push("CONSUMER_SUPABASE_URL", "CONSUMER_SERVICE_ROLE_KEY");
  if (!internalConfigured()) missing.push("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  return { missing };
}

const ATTR = (name: string) => `raw->event->subscriber_attributes->${name}->>value`;
const VARIANT_ATTR = ATTR("paywall_close_x_variant");
const SOURCE_ATTR = ATTR("paywall_close_x_source");

interface AssignmentDbRow {
  app_user_id: string;
  install_id: string | null;
  variant: string | null;
  salt: string | null;
  platform: string | null;
  created_at: string;
}

export async function fetchAssignments(): Promise<AssignmentRow[]> {
  const rows = await sbAll<AssignmentDbRow>(
    "consumer",
    `experiment_assignments?select=app_user_id,install_id,variant,salt,platform,created_at` +
      `&experiment_key=eq.${PAYWALL_X_KEY}&order=created_at.asc,id.asc`,
    200,
  );
  return rows.map((r) => ({
    appUserId: r.app_user_id,
    installId: r.install_id,
    variant: r.variant,
    salt: r.salt,
    platform: r.platform,
    createdAt: r.created_at,
  }));
}

export async function fetchCancels(sinceIso: string): Promise<CancelEvent[]> {
  const rows = await sbAll<{
    app_user_id: string | null;
    original_transaction_id: string | null;
    event_at: string;
    type: string;
    cancel_reason: string | null;
  }>(
    "internal",
    `rc_events?select=app_user_id,original_transaction_id,event_at,type,cancel_reason&type=in.(CANCELLATION,UNCANCELLATION)` +
      `&environment=eq.PRODUCTION&event_at=gte.${sinceIso}&order=event_at.asc,id.asc`,
    100,
  );
  return rows.map((r) => ({ userId: r.app_user_id, otx: r.original_transaction_id, at: r.event_at, type: r.type, cancelReason: r.cancel_reason }));
}

/** rc_events rows that carry the arm attribute, on any event type that carries attributes. */
export async function fetchArmTags(sinceIso: string, appUserId?: string): Promise<ArmTag[]> {
  const user = appUserId ? `&app_user_id=eq.${encodeURIComponent(appUserId)}` : "";
  const rows = await sbAll<{ app_user_id: string | null; event_at: string; v: string | null; s: string | null }>(
    "internal",
    `rc_events?select=app_user_id,event_at,v:${VARIANT_ATTR},s:${SOURCE_ATTR}&${VARIANT_ATTR}=not.is.null${user}` +
      `&environment=eq.PRODUCTION&type=in.(${ARM_EVENT_TYPES})&event_at=gte.${sinceIso}&order=type.asc,event_at.asc,id.asc`,
    100,
  );
  return rows.map((r) => ({ userId: r.app_user_id, at: r.event_at, variant: r.v, source: r.s }));
}

export type PaywallXResponse =
  | { configured: false; setup: PaywallXSetup }
  | { configured: true; setup: PaywallXSetup; readout: PaywallXReadout; tableMissing?: boolean };

let memo: { at: number; value: Promise<PaywallXResponse> } | null = null;

/** Cached 5 minutes like the April Plan reads; `fresh` recomputes. */
export function loadPaywallXReadout(opts: { fresh?: boolean; now?: Date } = {}): Promise<PaywallXResponse> {
  if (!opts.fresh && memo && Date.now() - memo.at < 5 * 60_000) return memo.value;
  const value = compute(opts.now ?? new Date());
  memo = { at: Date.now(), value };
  value.catch(() => {
    if (memo?.value === value) memo = null;
  });
  return value;
}

const EMPTY = { trials: [], charges: [], refunds: [], cancels: [], tags: [] };

async function compute(now: Date): Promise<PaywallXResponse> {
  const setup = paywallXSetup();
  if (setup.missing.length) return { configured: false, setup };
  let assignments: AssignmentRow[];
  try {
    assignments = await fetchAssignments();
  } catch (e) {
    if (e instanceof MissingTableError) {
      return { configured: true, setup, tableMissing: true, readout: buildPaywallXReadout({ assignments: [], ...EMPTY }, now) };
    }
    throw e;
  }
  if (!assignments.length) return { configured: true, setup, readout: buildPaywallXReadout({ assignments, ...EMPTY }, now) };

  // Padded a day early, from the first exposure's Eastern day: a stable key for fetchTrialStarts' cache.
  const first = assignments.reduce((m, a) => (a.createdAt < m ? a.createdAt : m), assignments[0].createdAt);
  const since = utcSinceForEasternDay(easternDate(first));
  const [trials, charges, refunds, cancels, tags] = await Promise.all([
    fetchTrialStarts(since),
    fetchCharges(since),
    fetchRefunds(since),
    fetchCancels(since),
    fetchArmTags(since),
  ]);
  return { configured: true, setup, readout: buildPaywallXReadout({ assignments, trials, charges, refunds, cancels, tags }, now) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One user's arm for the per-user chip: the exposure row first; with no row,
 * the newest RevenueCat attribute on any of their events (the attribute often
 * lands after the trial start). Null when they are not in the test, the id
 * isn't a uuid, or nothing is configured.
 */
export async function lookupPaywallXArm(appUserId: string): Promise<PaywallXUserArm | null> {
  if (!UUID.test(appUserId)) return null;
  if (consumerConfigured()) {
    try {
      const rows = await sbGet<AssignmentDbRow[]>(
        "consumer",
        `experiment_assignments?select=app_user_id,install_id,variant,salt,platform,created_at` +
          `&experiment_key=eq.${PAYWALL_X_KEY}&app_user_id=eq.${appUserId}&order=created_at.asc&limit=1`,
      );
      const r = rows[0];
      const arm = normalizeArm(r?.variant);
      if (r && arm) {
        return { arm, source: sourceFromSalt(r.salt), platform: normalizePlatform(r.platform), exposedAt: r.created_at, from: "assignment" };
      }
    } catch (e) {
      if (!(e instanceof MissingTableError)) throw e;
    }
  }
  if (!internalConfigured()) return null;
  // type + event_at bound so the (type, event_at) index does the work.
  const tags = await fetchArmTags(utcSinceForEasternDay(PAYWALL_X_EARLIEST_DAY), appUserId);
  const latest = tags.filter((t) => normalizeArm(t.variant)).sort((a, b) => b.at.localeCompare(a.at))[0];
  if (!latest) return null;
  return { arm: normalizeArm(latest.variant)!, source: normalizeSource(latest.source), platform: null, exposedAt: null, from: "revenuecat" };
}
