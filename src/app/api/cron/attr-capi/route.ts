/**
 * Attribution phase 3a — forward attributed installs, trial starts and first
 * paid starts to Meta's Conversions API WITH the click signals the redirect
 * link captured (fbc / fbp / ip / user agent), so a web-objective campaign
 * can optimize on them. The decision logic is pure (src/lib/attr-capi.ts,
 * tests/attr-capi.test.ts); this file is the I/O shell around it.
 *
 * Every 15 min via pg_cron (dreamme-admin-dash migration 0078 — the Vercel team
 * is on Hobby, which only allows daily crons), plus a daily Vercel backstop
 * at 07:50 UTC (vercel.json):
 *   1. rc_events (internal DB) trial + paid starts in the lookback window,
 *      plus each candidate subscription's full paid history (so "first paid
 *      start" is judged over the whole subscription) and its CANCELLATION
 *      events (a trial cancelled inside the qualification window never goes)
 *   2. attr_installs matched at high/medium confidence: those the events
 *      join to (dm_install_id, fallback app_user_id) plus every install
 *      first opened in the last 7 days (-> Lead) → their attr_clicks rows
 *   3. minus (event_name, event_id) pairs already in attr_capi_log for the
 *      target dataset
 *   4. hashed email from the CONSUMER project when its env is set (optional:
 *      fbc + ip + ua already satisfy website-event matching)
 *   5. POST batches ≤1000 to the dataset as action_source "website"
 *      (app-sourced custom events are dropped by this dataset — verified in
 *      Events Manager 2026-09-22), log outcome + fbtrace_id per event.
 *
 * Target dataset: META_ATTR_DATASET_ID (a dedicated, attributed-only web
 * dataset → standard names Lead / StartTrial / Subscribe) when set, else the
 * shared dataset (Lead / attr_start_trial / attr_subscribe); see
 * eventNamesFor. ATTR_TRIAL_QUALIFY_MINUTES (default 120, 30..1440) sets the
 * trial qualification window; ATTR_LEAD_EVENTS=off stops install → Lead.
 *
 * Retries: 'send_failed' rows are re-selected next tick (merge-duplicates
 * upsert overwrites them on success); nothing loops hot inside one run.
 *
 * Query params (same conventions as the dash's capi-trial-engaged):
 *   ?dry_run=1            compute + return the would-be batch, no send/log
 *   ?test_event_code=XX   forwarded to CAPI → Events Manager "Test events"
 *   ?hours=N              trial/paid lookback (default 72, 1..168 — Meta
 *                         rejects event_time older than 7 days anyway);
 *                         installs always look back the full 7 days
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { attrJobsEnabled } from "@/lib/attr-jobs";
import { resolveMeta } from "@/lib/meta-resolve";
import {
  buildCapiEvent,
  buildLogRow,
  chunk,
  eventNamesFor,
  logKey,
  qualifyMinutes,
  selectConversions,
  selectInstallConversions,
  userIdOf,
  MAX_EVENT_AGE_MS,
  SHARED_DATASET_ID,
  type CapiClick,
  type CapiEvent,
  type CapiInstall,
  type CapiLogRow,
  type CapiRcEvent,
  type Conversion,
} from "@/lib/attr-capi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INTERNAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const INTERNAL_KEY =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";
const CONSUMER_URL = process.env.CONSUMER_SUPABASE_URL ?? "";
const CONSUMER_KEY = process.env.CONSUMER_SERVICE_ROLE_KEY ?? "";

// A dedicated attributed-only dataset wins; else the shared dataset that
// RevenueCat's integration and the dash's CAPI crons post into.
const DATASET_ID =
  process.env.META_ATTR_DATASET_ID || process.env.META_DATASET_ID || SHARED_DATASET_ID;
const NAMES = eventNamesFor(DATASET_ID);
const QUALIFY_MS = qualifyMinutes(process.env.ATTR_TRIAL_QUALIFY_MINUTES) * 60_000;
const LEAD_EVENTS = process.env.ATTR_LEAD_EVENTS !== "off";
const META_API_VERSION = process.env.META_API_VERSION ?? "v22.0";

const RC_SELECT =
  "id,type,period_type,environment,event_at,app_user_id,dm_install_id,original_transaction_id,price_usd";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IN_CHUNK = 200; // keep PostgREST GET urls short

async function sbGet<T>(base: string, key: string, path: string): Promise<T[]> {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status} (${path.split("?")[0]}): ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T[];
}

const inList = (vals: string[]) =>
  `in.(${vals.map((v) => `"${v.replace(/"/g, "")}"`).join(",")})`;

/** Run an `in.(...)` query in chunks so long id lists never blow the URL. */
async function sbGetIn<T>(
  base: string,
  key: string,
  ids: string[],
  path: (list: string) => string,
): Promise<T[]> {
  const out: T[] = [];
  for (const part of chunk([...new Set(ids)], IN_CHUNK)) {
    if (!part.length) continue;
    out.push(...(await sbGet<T>(base, key, path(inList(part)))));
  }
  return out;
}

async function upsertLog(rows: CapiLogRow[]): Promise<void> {
  if (!rows.length) return;
  const res = await fetch(
    `${INTERNAL_URL}/rest/v1/attr_capi_log?on_conflict=dataset_id,event_name,event_id`,
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
    throw new Error(`attr_capi_log upsert ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/** app_user_id → email via the consumer project (subscriptions.rc_app_user_id
 *  → users.id, with the direct-uuid fallback the dash uses). Empty map when
 *  the consumer env is absent — the event still matches on fbc/ip/ua. */
async function resolveEmails(appUserIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!CONSUMER_URL || !CONSUMER_KEY || !appUserIds.length) return out;
  const subs = await sbGetIn<{ rc_app_user_id: string; user_id: string | null }>(
    CONSUMER_URL,
    CONSUMER_KEY,
    appUserIds,
    (list) => `subscriptions?select=rc_app_user_id,user_id&rc_app_user_id=${list}`,
  );
  const toUser = new Map<string, string>();
  for (const s of subs) if (s.user_id) toUser.set(s.rc_app_user_id, s.user_id);
  for (const id of appUserIds) if (!toUser.has(id) && UUID_RE.test(id)) toUser.set(id, id);
  const users = await sbGetIn<{ id: string; email: string | null }>(
    CONSUMER_URL,
    CONSUMER_KEY,
    [...new Set(toUser.values())],
    (list) => `users?select=id,email&id=${list}`,
  );
  const emailOf = new Map(users.map((u) => [u.id, u.email]));
  for (const [appUserId, userId] of toUser) {
    const email = emailOf.get(userId);
    if (email) out.set(appUserId, email);
  }
  return out;
}

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!INTERNAL_URL || !INTERNAL_KEY) {
    return NextResponse.json({ ok: false, error: "internal Supabase env missing" }, { status: 500 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  if (!dryRun && !attrJobsEnabled()) {
    return NextResponse.json({ ok: true, skipped: "ATTR_JOBS_ENABLED is not 1 (outlier still runs this job)" });
  }
  const testEventCode = url.searchParams.get("test_event_code") ?? undefined;
  const hoursParam = Number(url.searchParams.get("hours") ?? "72");
  const lookbackH = Number.isFinite(hoursParam) ? Math.min(Math.max(hoursParam, 1), 168) : 72;
  const now = Date.now();
  const since = new Date(now - lookbackH * 60 * 60 * 1000).toISOString();
  const installSince = new Date(now - MAX_EVENT_AGE_MS).toISOString();

  try {
    // 1. Trial + paid starts in the window.
    const windowEvents = await sbGet<CapiRcEvent>(
      INTERNAL_URL,
      INTERNAL_KEY,
      `rc_events?select=${RC_SELECT}&environment=eq.PRODUCTION&event_at=gte.${since}` +
        `&or=(and(type.eq.INITIAL_PURCHASE,period_type.eq.TRIAL),and(type.in.(INITIAL_PURCHASE,RENEWAL),period_type.eq.NORMAL))` +
        `&order=event_at.asc&limit=5000`,
    );
    const otids = [...new Set(windowEvents.map((e) => e.original_transaction_id).filter((v): v is string => !!v))];

    // 1b. Full paid history of those subscriptions → "first paid" is exact;
    //     their cancellations → trial qualification.
    const history = await sbGetIn<CapiRcEvent>(
      INTERNAL_URL,
      INTERNAL_KEY,
      otids,
      (list) =>
        `rc_events?select=${RC_SELECT}&environment=eq.PRODUCTION` +
        `&or=(type.eq.CANCELLATION,and(type.in.(INITIAL_PURCHASE,RENEWAL),period_type.eq.NORMAL))` +
        `&original_transaction_id=${list}&order=event_at.asc`,
    );
    const rcById = new Map<string, CapiRcEvent>();
    for (const e of [...windowEvents, ...history]) rcById.set(e.id, e);
    const rcEvents = [...rcById.values()];

    // 2. Installs those events can join to (dm_install_id first, app_user_id
    //    fallback), plus every recently matched install for Lead.
    const dmIds = [...new Set(rcEvents.map((e) => e.dm_install_id).filter((v): v is string => !!v && UUID_RE.test(v)))];
    const userIds = [...new Set(rcEvents.map((e) => e.app_user_id).filter((v): v is string => !!v))];
    const installSelect =
      "attr_installs?select=install_id,first_open_at,app_user_id,matched_click_id,match_confidence,match_method&matched_click_id=not.is.null";
    const [byDm, byUser, recent] = await Promise.all([
      sbGetIn<CapiInstall>(INTERNAL_URL, INTERNAL_KEY, dmIds, (list) => `${installSelect}&install_id=${list}`),
      sbGetIn<CapiInstall>(INTERNAL_URL, INTERNAL_KEY, userIds, (list) => `${installSelect}&app_user_id=${list}`),
      LEAD_EVENTS
        ? sbGet<CapiInstall>(
            INTERNAL_URL,
            INTERNAL_KEY,
            `${installSelect}&match_confidence=in.(high,medium)&first_open_at=gte.${installSince}` +
              `&order=first_open_at.asc&limit=5000`,
          )
        : Promise.resolve([] as CapiInstall[]),
    ]);
    const installById = new Map<string, CapiInstall>();
    for (const i of [...byDm, ...byUser]) installById.set(i.install_id, i);
    const installs = [...installById.values()];

    const clickIds = [
      ...new Set([...installs, ...recent].map((i) => i.matched_click_id).filter((v): v is string => !!v)),
    ];
    const clicks = await sbGetIn<CapiClick>(
      INTERNAL_URL,
      INTERNAL_KEY,
      clickIds,
      (list) =>
        `attr_clicks?select=click_id,clicked_at,ip,ua,fbclid,fbp,media_source,campaign_id,ad_id&click_id=${list}`,
    );

    // 3. Already decided in THIS dataset (send_failed stays retryable).
    const loggedRows = await sbGetIn<{ event_name: string; event_id: string }>(
      INTERNAL_URL,
      INTERNAL_KEY,
      [...otids, ...recent.map((i) => i.install_id)],
      (list) =>
        `attr_capi_log?select=event_name,event_id&dataset_id=eq.${DATASET_ID}` +
        `&status=neq.send_failed&event_id=${list}`,
    );
    const logged = new Set(loggedRows.map((r) => logKey(r.event_name, r.event_id)));

    const opts = { now, names: NAMES, qualifyMs: QUALIFY_MS };
    const conversions: Conversion[] = [
      ...selectInstallConversions(recent, clicks, logged, opts),
      ...selectConversions(installs, clicks, rcEvents, logged, opts),
    ];

    // 4. Hashed email (optional enrichment).
    const emails = await resolveEmails([...new Set(conversions.map(userIdOf).filter((v): v is string => !!v))]);
    const events: Array<{ c: Conversion; ev: CapiEvent }> = conversions.map((c) => ({
      c,
      ev: buildCapiEvent(c, emails.get(userIdOf(c) ?? "") ?? null),
    }));

    const tally = (list: Array<{ c: Conversion }>) => {
      const t: Record<string, number> = {};
      for (const { c } of list) t[c.event_name] = (t[c.event_name] ?? 0) + 1;
      return t;
    };

    const base = {
      dry_run: dryRun,
      dataset_id: DATASET_ID,
      lookback_hours: lookbackH,
      qualify_minutes: QUALIFY_MS / 60_000,
      lead_events: LEAD_EVENTS,
      events_seen: windowEvents.length,
      installs_matched: installs.length,
      installs_recent: recent.length,
      would_send: events.length,
      by_event: tally(events),
      with_email: events.filter(({ ev }) => !!ev.user_data.em).length,
      with_fbc: events.filter(({ ev }) => !!ev.user_data.fbc).length,
      with_fbp: events.filter(({ ev }) => !!ev.user_data.fbp).length,
      consumer_env: !!(CONSUMER_URL && CONSUMER_KEY),
      ...(testEventCode ? { test_event_code: testEventCode } : {}),
    };

    if (dryRun || !events.length) {
      return NextResponse.json({ ok: true, ...base, sent: 0, sample: events[0]?.ev ?? null });
    }

    // 5. Send in batches, log every outcome.
    const meta = await resolveMeta();
    if (!meta) {
      return NextResponse.json(
        { ok: false, ...base, sent: 0, send_error: "no Meta token (OAuth connection or META_ACCESS_TOKEN)" },
        { status: 500 },
      );
    }
    let sent = 0;
    const sendErrors: string[] = [];
    const logRows: CapiLogRow[] = [];
    for (const batch of chunk(events)) {
      const body: Record<string, unknown> = { data: batch.map(({ ev }) => ev) };
      if (testEventCode) body.test_event_code = testEventCode;
      let resBody: Record<string, unknown> = {};
      let okSend = false;
      try {
        const res = await fetch(
          `https://graph.facebook.com/${META_API_VERSION}/${DATASET_ID}/events?access_token=${encodeURIComponent(meta.token)}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        );
        resBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        okSend = res.ok && !resBody.error;
      } catch (e) {
        resBody = { error: { message: e instanceof Error ? e.message : String(e) } };
      }
      if (okSend) sent += batch.length;
      else sendErrors.push(JSON.stringify(resBody).slice(0, 300));
      for (const { c } of batch) logRows.push(buildLogRow(c, DATASET_ID, okSend ? "sent" : "send_failed", resBody));
    }
    await upsertLog(logRows);

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
