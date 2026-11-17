/**
 * Server side of the experiments panel: trial starts, charges and refunds from
 * rc_events, plus each user's arm read out of the stored webhook payloads.
 * The rules live in experiments.ts.
 */
import { num, sbAll } from "./db";
import { EXPERIMENTS, armsFromEvents, rcVariant, readExperiment, type ExperimentDef, type ExperimentRead } from "./experiments";
import type { Charge } from "./value-per-trial";
import { fetchCharges, fetchTrialStarts } from "./value-per-trial-data";

/** Event types that carry subscriber attributes after the trial starts. */
export const ARM_EVENT_TYPES = "INITIAL_PURCHASE,RENEWAL,CANCELLATION,EXPIRATION,PRODUCT_CHANGE,BILLING_ISSUE,UNCANCELLATION";

export async function fetchRefunds(sinceIso: string): Promise<Charge[]> {
  const rows = await sbAll<{ app_user_id: string | null; original_transaction_id: string | null; event_at: string; price_usd: string | number | null }>(
    "internal",
    `rc_events?select=app_user_id,original_transaction_id,event_at,price_usd&type=eq.CANCELLATION&cancel_reason=eq.CUSTOMER_SUPPORT` +
      `&environment=eq.PRODUCTION&event_at=gte.${sinceIso}&order=event_at.asc,id.asc`,
  );
  return rows.map((r) => ({
    userId: r.app_user_id,
    otx: r.original_transaction_id,
    at: r.event_at,
    priceUsd: -Math.abs(num(r.price_usd)),
    productId: null,
    periodDays: null,
  }));
}

async function armMap(def: ExperimentDef, sinceIso: string): Promise<Map<string, string>> {
  const base = `&environment=eq.PRODUCTION&type=in.(${ARM_EVENT_TYPES})&event_at=gte.${sinceIso}&order=type.asc,event_at.asc,id.asc`;
  if (def.source.kind === "attribute") {
    const path = `raw->event->subscriber_attributes->${def.source.name}->>value`;
    const rows = await sbAll<{ app_user_id: string | null; v: string | null }>("internal", `rc_events?select=app_user_id,v:${path}&${path}=not.is.null${base}`);
    return armsFromEvents(rows.map((r) => ({ userId: r.app_user_id, value: r.v })));
  }
  const id = def.source.experimentId;
  if (!id) return new Map();
  const rows = await sbAll<{ app_user_id: string | null; x: unknown }>("internal", `rc_events?select=app_user_id,x:raw->event->experiments&raw->event->experiments=not.is.null${base}`);
  return armsFromEvents(rows.map((r) => ({ userId: r.app_user_id, value: rcVariant(r.x, id) })));
}

let memo: { at: number; value: Promise<ExperimentRead[]> } | null = null;

export function loadExperiments(now = new Date()): Promise<ExperimentRead[]> {
  if (memo && Date.now() - memo.at < 5 * 60_000) return memo.value;
  const value = compute(now);
  memo = { at: Date.now(), value };
  value.catch(() => {
    if (memo?.value === value) memo = null;
  });
  return value;
}

async function compute(now: Date): Promise<ExperimentRead[]> {
  const started = EXPERIMENTS.filter((e) => e.status !== "draft" && e.start);
  if (!started.length) return EXPERIMENTS.map((e) => readExperiment(e, [], new Map(), [], now));
  const since = new Date(Date.parse(`${started.map((e) => e.start!).sort()[0]}T00:00:00Z`)).toISOString();
  const [trials, charges, refunds] = await Promise.all([fetchTrialStarts(since), fetchCharges(since), fetchRefunds(since)]);
  const all = [...charges, ...refunds];
  // Experiments sharing an arm source share one read of it.
  const maps = new Map<string, Promise<Map<string, string>>>();
  const reads: ExperimentRead[] = [];
  for (const e of EXPERIMENTS) {
    if (e.status === "draft" || !e.start) {
      reads.push(readExperiment(e, [], new Map(), [], now));
      continue;
    }
    const key = JSON.stringify(e.source);
    if (!maps.has(key)) maps.set(key, armMap(e, since));
    reads.push(readExperiment(e, trials, await maps.get(key)!, all, now));
  }
  return reads;
}
