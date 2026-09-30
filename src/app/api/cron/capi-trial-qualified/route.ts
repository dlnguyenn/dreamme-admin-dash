/**
 * trial_qualified → Meta Conversions API (replaces the dead n8n bridge).
 *
 * Every 15 min (GitHub Actions, .github/workflows/capi-trial-qualified.yml —
 * a failing run goes red and emails the owner, unlike n8n which died
 * silently on 2026-07-06):
 *   1. PRODUCTION app/play trials from rc_events in the lookback window
 *   2. minus trials already decided in capi_trial_qualified_log
 *   3. for each trial ≥2h old: RevenueCat v2 subscriptions → qualified when
 *      still trialing/active and renewing (src/lib/capi-trial-qualified.ts)
 *   4. qualified → one website CAPI event with hashed email + external_id,
 *      ip ($ip attribute, else install ip) and ua (attr_installs). Events
 *      without a ua go in their own batch so a rejection there can't sink
 *      the rest.
 * RevenueCat errors leave a trial undecided for the next tick.
 *
 * Query params: ?dry_run=1 (compute, no send, no log), ?test_event_code=XX
 * (forwarded to CAPI for Events Manager Test Events; nothing is logged, so
 * the real send still happens later), ?hours=N lookback (default 8, max 72).
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { resolveMeta } from "@/lib/meta-resolve";
import {
  buildEvent,
  decide,
  isDue,
  matchKeys,
  type CapiEvent,
  type Decision,
  type TrialRow,
} from "@/lib/capi-trial-qualified";
import {
  getCustomerSubscriptions,
  revenueCatConfigured,
} from "@/lib/vendors/revenuecat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INTERNAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const INTERNAL_KEY =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const META_DATASET_ID = process.env.META_DATASET_ID ?? "1777837186267557";
const META_API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const RC_CONCURRENCY = 4;
const IN_CHUNK = 150; // keep PostgREST GET urls short

async function sbGet<T>(path: string): Promise<T[]> {
  const res = await fetch(`${INTERNAL_URL}/rest/v1/${path}`, {
    headers: { apikey: INTERNAL_KEY, Authorization: `Bearer ${INTERNAL_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status} (${path.split("?")[0]}): ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T[];
}

const inList = (vals: string[]) =>
  `in.(${vals.map((v) => `"${v.replace(/"/g, "")}"`).join(",")})`;

async function sbGetIn<T>(ids: string[], path: (list: string) => string): Promise<T[]> {
  const uniq = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += IN_CHUNK) {
    out.push(...(await sbGet<T>(path(inList(uniq.slice(i, i + IN_CHUNK))))));
  }
  return out;
}

async function upsertLog(rows: LogRow[]): Promise<void> {
  if (!rows.length) return;
  const res = await fetch(
    `${INTERNAL_URL}/rest/v1/capi_trial_qualified_log?on_conflict=original_transaction_id`,
    {
      method: "POST",
      headers: {
        apikey: INTERNAL_KEY,
        Authorization: `Bearer ${INTERNAL_KEY}`,
        "Content-Type": "application/json",
        // a successful retry overwrites an earlier send_failed row
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    },
  );
  if (!res.ok) {
    throw new Error(`capi_trial_qualified_log upsert ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/** Concurrent map with a fixed parallelism cap. */
async function pMap<T, R>(items: T[], worker: (item: T) => Promise<R>, n: number): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await worker(items[i]);
      }
    }),
  );
  return out;
}

type LogStatus = Exclude<Decision, "qualified"> | "sent" | "send_failed";

/** Uniform row shape: PostgREST bulk insert needs identical keys. */
interface LogRow {
  original_transaction_id: string;
  app_user_id: string;
  store: string;
  trial_started_at: string;
  status: LogStatus;
  has_ua: boolean | null;
  meta_response: unknown;
}

const logRow = (
  t: TrialRow,
  status: LogStatus,
  hasUa: boolean | null = null,
  metaResponse: unknown = null,
): LogRow => ({
  original_transaction_id: t.original_transaction_id,
  app_user_id: t.app_user_id,
  store: t.store,
  trial_started_at: t.event_at,
  status,
  has_ua: hasUa,
  meta_response: metaResponse,
});

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!INTERNAL_URL || !INTERNAL_KEY) {
    return NextResponse.json({ ok: false, error: "internal Supabase env missing" }, { status: 500 });
  }
  if (!revenueCatConfigured()) {
    return NextResponse.json({ ok: false, error: "RevenueCat env missing" }, { status: 500 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const testEventCode = url.searchParams.get("test_event_code") ?? undefined;
  const hoursParam = Number(url.searchParams.get("hours") ?? "8");
  const lookbackH = Number.isFinite(hoursParam) ? Math.min(Math.max(hoursParam, 1), 72) : 8;
  const now = Date.now();
  const since = new Date(now - lookbackH * 60 * 60 * 1000).toISOString();

  try {
    // 1. Recent production store trials, one row per transaction.
    const rows = await sbGet<TrialRow>(
      `rc_events?select=original_transaction_id,app_user_id,store,event_at,product_id,` +
        `attrs:raw->event->subscriber_attributes` +
        `&type=eq.INITIAL_PURCHASE&period_type=eq.TRIAL&environment=eq.PRODUCTION` +
        `&store=in.(APP_STORE,PLAY_STORE)&event_at=gte.${since}&order=event_at.asc&limit=2000`,
    );
    const byOid = new Map<string, TrialRow>();
    for (const t of rows) {
      if (t.original_transaction_id && t.app_user_id && !byOid.has(t.original_transaction_id)) {
        byOid.set(t.original_transaction_id, t);
      }
    }

    // 2. Drop trials already decided (send_failed stays retryable).
    const decided = await sbGetIn<{ original_transaction_id: string }>(
      [...byOid.keys()],
      (list) =>
        `capi_trial_qualified_log?select=original_transaction_id` +
        `&status=neq.send_failed&original_transaction_id=${list}`,
    );
    for (const d of decided) byOid.delete(d.original_transaction_id);

    const due = [...byOid.values()].filter((t) => isDue(t, now));
    const notYetDue = byOid.size - due.length;

    // 3. RevenueCat check per due trial.
    const checked = await pMap(
      due,
      async (t) => {
        try {
          return { t, decision: decide(t.store, await getCustomerSubscriptions(t.app_user_id)) };
        } catch (e) {
          return { t, error: e instanceof Error ? e.message : String(e) };
        }
      },
      RC_CONCURRENCY,
    );
    const rcErrors = checked.filter((c) => "error" in c);
    const logRows: LogRow[] = [];
    const qualified: TrialRow[] = [];
    for (const c of checked) {
      if (!("decision" in c) || !c.decision) continue;
      if (c.decision === "qualified") qualified.push(c.t);
      else logRows.push(logRow(c.t, c.decision));
    }

    // 4. ua/ip from the install registry (latest install per user).
    const installs = await sbGetIn<{ app_user_id: string; ip: string | null; ua: string | null }>(
      qualified.map((t) => t.app_user_id),
      (list) =>
        `attr_installs?select=app_user_id,ip,ua&ua=not.is.null` +
        `&app_user_id=${list}&order=first_open_at.asc`,
    );
    const installOf = new Map(installs.map((i) => [i.app_user_id, i])); // last wins = latest
    const events = qualified.map((t) => ({
      t,
      ev: buildEvent(t, matchKeys(t, installOf.get(t.app_user_id))),
    }));

    const tally: Record<string, number> = {};
    for (const r of logRows) tally[r.status] = (tally[r.status] ?? 0) + 1;
    const base = {
      dry_run: dryRun,
      lookback_hours: lookbackH,
      trials_seen: byOid.size + decided.length,
      already_decided: decided.length,
      not_yet_due: notYetDue,
      rc_errors: rcErrors.length,
      qualified: qualified.length,
      with_email: events.filter(({ ev }) => ev.user_data.em).length,
      with_ua: events.filter(({ ev }) => ev.user_data.client_user_agent).length,
      closed: tally,
      ...(testEventCode ? { test_event_code: testEventCode } : {}),
    };

    if (dryRun || !events.length) {
      if (!dryRun) await upsertLog(logRows);
      return NextResponse.json({ ok: true, ...base, sent: 0, sample: events[0]?.ev ?? null });
    }

    // 5. Send: events with a ua, then events without one, as separate batches.
    const meta = await resolveMeta();
    if (!meta) {
      await upsertLog(logRows);
      return NextResponse.json(
        { ok: false, ...base, sent: 0, send_error: "no Meta token (OAuth connection or META_ACCESS_TOKEN)" },
        { status: 500 },
      );
    }
    let sent = 0;
    const sendErrors: string[] = [];
    const batches = [
      events.filter(({ ev }) => ev.user_data.client_user_agent),
      events.filter(({ ev }) => !ev.user_data.client_user_agent),
    ].filter((b) => b.length);
    for (const batch of batches) {
      const body: { data: CapiEvent[]; test_event_code?: string } = { data: batch.map(({ ev }) => ev) };
      if (testEventCode) body.test_event_code = testEventCode;
      let resBody: Record<string, unknown> = {};
      let okSend = false;
      try {
        const res = await fetch(
          `https://graph.facebook.com/${META_API_VERSION}/${META_DATASET_ID}/events?access_token=${encodeURIComponent(meta.token)}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        );
        resBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        okSend = res.ok && !resBody.error;
      } catch (e) {
        resBody = { error: { message: e instanceof Error ? e.message : String(e) } };
      }
      if (okSend) sent += batch.length;
      else sendErrors.push(JSON.stringify(resBody).slice(0, 300));
      for (const { t, ev } of batch) {
        logRows.push(logRow(t, okSend ? "sent" : "send_failed", !!ev.user_data.client_user_agent, resBody));
      }
    }

    // Test sends go to Events Manager's Test Events only: log just the
    // terminal non-qualified decisions so the real send still happens later.
    await upsertLog(testEventCode ? logRows.filter((r) => r.status !== "sent" && r.status !== "send_failed") : logRows);

    return NextResponse.json({
      ok: sendErrors.length === 0,
      ...base,
      sent,
      failed: events.length - sent,
      ...(sendErrors.length ? { send_errors: sendErrors } : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
