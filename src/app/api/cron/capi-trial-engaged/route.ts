/**
 * trial_engaged → Meta Conversions API (server-side qualified-trial signal).
 *
 * Every 15 min (pg_cron, migration 0069): find PRODUCTION trials started in
 * the last lookback window (internal rc_events), check the CONSUMER project
 * for a meal / body_log / injection_log created within 4h of trial start,
 * and send a `trial_engaged` custom app event to the Meta dataset the moment
 * a trial qualifies. 4h deadline + send-on-engagement keeps the event inside
 * our 1-day click attribution (58.5% of engagers log within 30 min anyway —
 * 2026-08-27 sizing over 60d: 64.9% engage <4h ≈ 180/wk).
 *
 * Dedupe: capi_trial_engaged_log, one decision per original_transaction_id.
 * Trials younger than 4h that haven't engaged yet are left undecided so a
 * later tick can still qualify them; after 4h they're closed out terminally.
 *
 * Matching: SHA-256 hashed email (CAPI user_data.em) — works regardless of
 * ATT. event_id = original_transaction_id so Meta dedupes against any future
 * SDK-side duplicate. Store → extinfo platform ("i2"/"a2"); STRIPE/web
 * trials are skipped (no app to attribute).
 *
 * Query params: ?dry_run=1 (compute, no send, no log), ?test_event_code=XX
 * (forwarded to CAPI for Events Manager Test Events), ?hours=N lookback
 * override (default 8, max 72 — raise for a one-off backfill).
 */
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { resolveMeta } from "@/lib/meta-resolve";

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

// Same dataset RevenueCat's CAPI integration posts into (ads-mcp DEFAULT_DATASET).
const META_DATASET_ID = process.env.META_DATASET_ID ?? "1777837186267557";
const META_API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const ENGAGE_WINDOW_MS = 4 * 60 * 60 * 1000; // 4h — see header

type TrialRow = {
  original_transaction_id: string;
  app_user_id: string;
  store: string | null;
  event_at: string;
};

async function sbGet<T>(base: string, key: string, path: string): Promise<T> {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function sbInsert(
  base: string,
  key: string,
  table: string,
  rows: unknown[],
): Promise<void> {
  if (!rows.length) return;
  const res = await fetch(`${base}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      // merge so a successful retry overwrites an earlier send_failed row
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(`insert ${table} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

const sha256 = (s: string) =>
  createHash("sha256").update(s.trim().toLowerCase()).digest("hex");

const inList = (vals: string[]) =>
  `in.(${vals.map((v) => `"${v.replace(/"/g, "")}"`).join(",")})`;

/**
 * Minimal extinfo accepted by CAPI (required when action_source=app; empty
 * version fields are rejected with subcode 2804043). We don't know the real
 * device, so send plausible platform-consistent placeholders — matching runs
 * on hashed email, not on these.
 */
const extinfo = (platform: "i2" | "a2") => [
  platform,                       // 0 extinfo version
  "com.dreamme.app",              // 1 package
  "1",                            // 2 build
  "1.0",                          // 3 app version
  platform === "i2" ? "17.0" : "14.0", // 4 OS version
  "", "", "", "",                 // 5-8 model / locale / tz abbr / carrier
  "0", "0", "0",                  // 9-11 screen w / h / density
  "0", "0", "0", "",              // 12-15 cores / storage / free / timezone
];

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!INTERNAL_URL || !INTERNAL_KEY || !CONSUMER_URL || !CONSUMER_KEY) {
    return NextResponse.json(
      { ok: false, error: "internal/consumer Supabase env missing" },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const testEventCode = url.searchParams.get("test_event_code") ?? undefined;
  const hoursParam = Number(url.searchParams.get("hours") ?? "8");
  const lookbackH = Number.isFinite(hoursParam)
    ? Math.min(Math.max(hoursParam, 1), 72)
    : 8;

  const now = Date.now();
  const since = new Date(now - lookbackH * 60 * 60 * 1000).toISOString();

  // 1. Recent production app-store trials (internal rc_events).
  const trials = await sbGet<TrialRow[]>(
    INTERNAL_URL,
    INTERNAL_KEY,
    `rc_events?select=original_transaction_id,app_user_id,store,event_at` +
      `&type=eq.INITIAL_PURCHASE&period_type=eq.TRIAL&environment=eq.PRODUCTION` +
      `&event_at=gte.${since}&order=event_at.asc&limit=1000`,
  );
  // One row per transaction (rc_events can carry re-sends of the same event).
  const byOid = new Map<string, TrialRow>();
  for (const t of trials) {
    if (t.original_transaction_id && !byOid.has(t.original_transaction_id)) {
      byOid.set(t.original_transaction_id, t);
    }
  }

  // 2. Drop trials already decided.
  const oids = [...byOid.keys()];
  const decided = oids.length
    ? await sbGet<Array<{ original_transaction_id: string }>>(
        INTERNAL_URL,
        INTERNAL_KEY,
        // send_failed is retryable — a later tick re-decides and re-sends it
        `capi_trial_engaged_log?select=original_transaction_id` +
          `&status=neq.send_failed&original_transaction_id=${inList(oids)}`,
      )
    : [];
  for (const d of decided) byOid.delete(d.original_transaction_id);

  const pending = [...byOid.values()].filter(
    (t) => t.store === "APP_STORE" || t.store === "PLAY_STORE",
  );
  const skippedNonApp = byOid.size - pending.length;

  if (!pending.length) {
    return NextResponse.json({
      ok: true, dry_run: dryRun, lookback_hours: lookbackH,
      trials_seen: trials.length, pending: 0, skipped_non_app: skippedNonApp,
      sent: 0, closed: 0,
    });
  }

  // 3. rc_app_user_id → consumer user_id (+ direct-uuid fallback), then emails.
  const appUserIds = [...new Set(pending.map((t) => t.app_user_id))];
  const subMap = await sbGet<Array<{ rc_app_user_id: string; user_id: string | null }>>(
    CONSUMER_URL,
    CONSUMER_KEY,
    `subscriptions?select=rc_app_user_id,user_id&rc_app_user_id=${inList(appUserIds)}`,
  );
  const toUser = new Map<string, string>();
  for (const s of subMap) if (s.user_id) toUser.set(s.rc_app_user_id, s.user_id);
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const id of appUserIds) {
    if (!toUser.has(id) && uuidRe.test(id)) toUser.set(id, id);
  }

  const userIds = [...new Set([...toUser.values()])];
  const users = userIds.length
    ? await sbGet<Array<{ id: string; email: string | null }>>(
        CONSUMER_URL,
        CONSUMER_KEY,
        `users?select=id,email&id=${inList(userIds)}`,
      )
    : [];
  const emailOf = new Map(users.map((u) => [u.id, u.email]));

  // 4. Earliest qualifying log per user since the oldest pending trial start.
  const earliest = pending.reduce(
    (m, t) => Math.min(m, Date.parse(t.event_at)),
    Infinity,
  );
  // ALL log timestamps per user, not just the first: onboarding logs the
  // starting weight seconds-to-minutes BEFORE the trial starts, so a user's
  // earliest log is routinely pre-trial. Each trial must find the first log
  // inside its own [start, start+4h] window.
  const logsSince = new Date(earliest).toISOString();
  const logsByUser = new Map<string, number[]>();
  for (const table of ["meals", "body_log", "injection_logs"]) {
    if (!userIds.length) break;
    const rows = await sbGet<Array<{ user_id: string; created_at: string }>>(
      CONSUMER_URL,
      CONSUMER_KEY,
      `${table}?select=user_id,created_at&user_id=${inList(userIds)}` +
        `&created_at=gte.${logsSince}&order=created_at.asc&limit=5000`,
    );
    for (const r of rows) {
      const ts = Date.parse(r.created_at);
      const arr = logsByUser.get(r.user_id);
      if (arr) arr.push(ts);
      else logsByUser.set(r.user_id, [ts]);
    }
  }

  // 5. Decide each pending trial.
  const toSend: Array<{ t: TrialRow; engagedAt: number; email: string }> = [];
  const toClose: Array<Record<string, unknown>> = [];
  let stillOpen = 0;
  for (const t of pending) {
    const started = Date.parse(t.event_at);
    const deadline = started + ENGAGE_WINDOW_MS;
    const userId = toUser.get(t.app_user_id);
    const windowClosed = now > deadline;

    if (!userId) {
      if (windowClosed)
        toClose.push({ ...logRow(t), status: "no_user_map" });
      else stillOpen++;
      continue;
    }
    const eng = (logsByUser.get(userId) ?? [])
      .filter((ts) => ts >= started && ts <= deadline)
      .reduce<number | undefined>((m, ts) => (m === undefined || ts < m ? ts : m), undefined);
    const engagedInWindow = eng !== undefined;
    if (!engagedInWindow) {
      if (windowClosed)
        toClose.push({ ...logRow(t), status: "no_engagement" });
      else stillOpen++;
      continue;
    }
    const email = emailOf.get(userId);
    if (!email) {
      toClose.push({ ...logRow(t), status: "no_email", engaged_at: new Date(eng).toISOString() });
      continue;
    }
    toSend.push({ t, engagedAt: eng, email });
  }

  // 6. Send to CAPI (one batch) and log outcomes.
  let sent = 0;
  let sendError: string | null = null;
  if (toSend.length && !dryRun) {
    const meta = await resolveMeta();
    if (!meta) {
      sendError = "no Meta token (OAuth connection or META_ACCESS_TOKEN)";
    } else {
      const events = toSend.map(({ t, engagedAt, email }) => ({
        event_name: "trial_engaged",
        event_time: Math.floor(engagedAt / 1000),
        event_id: t.original_transaction_id,
        action_source: "app",
        user_data: { em: [sha256(email)] },
        app_data: {
          advertiser_tracking_enabled: false,
          application_tracking_enabled: false,
          extinfo: extinfo(t.store === "PLAY_STORE" ? "a2" : "i2"),
        },
      }));
      const body: Record<string, unknown> = { data: events };
      if (testEventCode) body.test_event_code = testEventCode;
      const res = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${META_DATASET_ID}/events?access_token=${encodeURIComponent(meta.token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const resBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const okSend = res.ok && !resBody.error;
      if (okSend) sent = toSend.length;
      else sendError = JSON.stringify(resBody).slice(0, 300);
      for (const { t, engagedAt } of toSend) {
        toClose.push({
          ...logRow(t),
          status: okSend ? "sent" : "send_failed",
          engaged_at: new Date(engagedAt).toISOString(),
          meta_response: resBody,
        });
      }
    }
  }

  if (!dryRun) {
    await sbInsert(INTERNAL_URL, INTERNAL_KEY, "capi_trial_engaged_log", toClose);
  }

  const statusTally: Record<string, number> = {};
  for (const r of toClose) {
    const s = String(r.status);
    statusTally[s] = (statusTally[s] ?? 0) + 1;
  }
  if (dryRun) statusTally.would_send = toSend.length;

  return NextResponse.json({
    statuses: statusTally,
    ok: !sendError,
    dry_run: dryRun,
    lookback_hours: lookbackH,
    trials_seen: trials.length,
    pending: pending.length,
    skipped_non_app: skippedNonApp,
    would_send: dryRun ? toSend.length : undefined,
    sent,
    closed_terminal: toClose.length,
    still_open: stillOpen,
    ...(sendError ? { send_error: sendError } : {}),
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  });
}

/**
 * Uniform row shape — PostgREST bulk insert (PGRST102) requires every row in
 * a batch to carry identical keys, so optional fields default to null.
 */
function logRow(t: TrialRow) {
  return {
    original_transaction_id: t.original_transaction_id,
    app_user_id: t.app_user_id,
    store: t.store,
    trial_started_at: t.event_at,
    engaged_at: null as string | null,
    meta_response: null as unknown,
  };
}
