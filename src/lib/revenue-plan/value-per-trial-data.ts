/**
 * Server side of the value-per-trial panel: pull trial starts and charges from
 * rc_events, join sources, and hand the rows to the pure math in
 * value-per-trial.ts. Also the live break-even the switchback verdict uses.
 */
import { addDays, easternDate, utcSinceForEasternDay, weekStart } from "./dates";
import { num, sbAll } from "./db";
import { REFERENCE_NET, SOURCE_GROUPS, type SourceGroup } from "./sources";
import { loadSources, sourceStatus, type SourceStatus } from "./user-sources";
import {
  buildCohorts,
  net12Series,
  summarize,
  type Charge,
  type Cohort,
  type GroupSummary,
  type SummaryKey,
  type TrialStart,
} from "./value-per-trial";

export const DEFAULT_WEEKS = 16;
/** Payer-mature weeks each summary metric reads. */
export const SUMMARY_WEEKS = 6;
/** The vault's reference window: trials onboarded Aug 24 - Oct 11 (by trial week here). */
export const VAULT_WINDOW = { from: "2026-08-24", to: "2026-10-05" } as const;

export interface RcTrialRow {
  app_user_id: string | null;
  original_transaction_id: string | null;
  event_at: string;
  store: string | null;
}

const trialCache = new Map<string, { at: number; value: Promise<TrialStart[]> }>();

/** Trial starts since `sinceIso`, cached 5 minutes: the three panels and the switchback all read them. */
export function fetchTrialStarts(sinceIso: string): Promise<TrialStart[]> {
  const hit = trialCache.get(sinceIso);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
  const value = readTrialStarts(sinceIso);
  trialCache.set(sinceIso, { at: Date.now(), value });
  value.catch(() => trialCache.delete(sinceIso));
  return value;
}

async function readTrialStarts(sinceIso: string): Promise<TrialStart[]> {
  const rows = await sbAll<RcTrialRow>(
    "internal",
    `rc_events?select=app_user_id,original_transaction_id,event_at,store&type=eq.INITIAL_PURCHASE&period_type=eq.TRIAL` +
      `&environment=eq.PRODUCTION&event_at=gte.${sinceIso}&order=event_at.asc,id.asc`,
  );
  return rows.map((r) => ({
    otx: r.original_transaction_id ?? `${r.app_user_id}:${r.event_at}`,
    userId: r.app_user_id,
    at: r.event_at,
    store: r.store,
  }));
}

export async function fetchCharges(sinceIso: string): Promise<Charge[]> {
  const rows = await sbAll<{
    app_user_id: string | null;
    original_transaction_id: string | null;
    event_at: string;
    price_usd: string | number | null;
    product_id: string | null;
    expiration_at: string | null;
  }>(
    "internal",
    `rc_events?select=app_user_id,original_transaction_id,event_at,price_usd,product_id,expiration_at` +
      `&type=in.(RENEWAL,INITIAL_PURCHASE,NON_RENEWING_PURCHASE)&period_type=eq.NORMAL&environment=eq.PRODUCTION` +
      `&event_at=gte.${sinceIso}&order=event_at.asc,id.asc`,
  );
  return rows.map((r) => ({
    userId: r.app_user_id,
    otx: r.original_transaction_id,
    at: r.event_at,
    priceUsd: num(r.price_usd),
    productId: r.product_id,
    periodDays: r.expiration_at ? (Date.parse(r.expiration_at) - Date.parse(r.event_at)) / 86_400_000 : null,
  }));
}

export interface ValuePerTrialResponse {
  today: string;
  from: string;
  cohorts: Cohort[];
  latest: Record<SummaryKey, GroupSummary>;
  vaultWindow: Record<SummaryKey, GroupSummary>;
  series: Record<SourceGroup, { week: string; value: number | null; trials: number }[]>;
  reference: typeof REFERENCE_NET;
  sources: SourceStatus;
  /** Trials whose app_user_id has no consumer user row (anonymous ids, deleted accounts). */
  unmatchedTrials: number;
  totalTrials: number;
}

let memo: { key: string; at: number; value: Promise<ValuePerTrialResponse> } | null = null;

export function loadValuePerTrial(weeks = DEFAULT_WEEKS, now = new Date()): Promise<ValuePerTrialResponse> {
  const today = easternDate(now);
  const key = `${weeks}|${today}`;
  if (memo && memo.key === key && Date.now() - memo.at < 5 * 60_000) return memo.value;
  const value = compute(weeks, today);
  memo = { key, at: Date.now(), value };
  value.catch(() => {
    if (memo?.value === value) memo = null;
  });
  return value;
}

async function compute(weeks: number, today: string): Promise<ValuePerTrialResponse> {
  const from = weekStart(addDays(today, -7 * (weeks - 1)));
  const since = utcSinceForEasternDay(from);
  const [allTrials, charges, status] = await Promise.all([fetchTrialStarts(since), fetchCharges(since), sourceStatus()]);
  const trials = allTrials.filter((t) => easternDate(t.at) >= from);
  const sources = await loadSources(
    trials.map((t) => t.userId ?? ""),
    status.backend,
  );
  const cohorts = buildCohorts(trials, charges, sources, today);
  const series = Object.fromEntries(SOURCE_GROUPS.map((g) => [g, net12Series(cohorts, g)])) as ValuePerTrialResponse["series"];
  return {
    today,
    from,
    cohorts,
    latest: summarize(cohorts, { lastN: SUMMARY_WEEKS }),
    vaultWindow: summarize(cohorts, VAULT_WINDOW),
    series,
    reference: REFERENCE_NET,
    sources: status,
    unmatchedTrials: cohorts.filter((c) => c.group === "unmatched").reduce((s, c) => s + c.trials, 0),
    totalTrials: trials.length,
  };
}

/** Break-even for the Meta verdict: the live Meta 12-month net per trial, else the vault reference. */
export async function metaBreakEven(): Promise<{ value: number; basis: string }> {
  try {
    const v = await loadValuePerTrial();
    const m = v.latest.meta;
    if (m.net12PerTrial != null && m.payerTrials >= 300) {
      return { value: m.net12PerTrial, basis: `Meta trials' projected 12-month net, ${m.payerWeeks.length} latest mature weeks` };
    }
  } catch {
    // fall through to the reference
  }
  return { value: REFERENCE_NET.meta, basis: "vault reference, trials onboarded Aug 24 - Oct 11" };
}
