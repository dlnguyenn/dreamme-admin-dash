/**
 * Trial emails sender — fired every 5 minutes by pg_cron (migration 0109)
 * while trial_email_config.enabled is true. Bearer CRON_SECRET only.
 *
 * Each run:
 *  1. Assign new trials (started after config.started_at, under 6h old) to
 *     an arm on a hash of app_user_id. Both arms are recorded; only the email
 *     arm is ever sent anything.
 *  2. Mark email-arm rows whose send window passed unclaimed as window_missed.
 *  3. Day 0 (0-6h after trial start) and day 1 (24-30h): claim the row (an
 *     atomic null -> now flip, so overlapping runs cannot double send), read
 *     the trial's live status and the user's facts, apply the skip rules,
 *     then send or record the skip reason.
 * Rules live in lib/trial-emails/core.ts; design in vault wiki/trial-email-test.md.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { supportDbConfigured } from "@/lib/support/db";
import {
  ASSIGN_WINDOW_MS,
  EXPERIMENT,
  armOf,
  bucketOf,
  decide,
  firstName,
  fishName,
  isRealUserId,
  platformOf,
  sendWindows,
  trialEndLabel,
  trialStatus,
  variantLabel,
} from "@/lib/trial-emails/core";
import {
  activity,
  assignedIds,
  claim,
  consumerConfigured,
  consumerUsers,
  dueRows,
  fetchNewTrials,
  getConfig,
  insertAssignment,
  isSuppressed,
  markMissed,
  patchAssignment,
  priorBuyers,
  trialEvents,
} from "@/lib/trial-emails/db";
import { mailerReady, render, sendEmail } from "@/lib/trial-emails/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supportDbConfigured() || !consumerConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase env missing" }, { status: 500 });
  }

  const cfg = await getConfig();
  if (!cfg?.enabled || !cfg.started_at) return NextResponse.json({ ok: true, enabled: false });
  if (!mailerReady()) return NextResponse.json({ ok: false, error: "DREAMME_SMTP_PASS not set" }, { status: 500 });

  const now = new Date();
  const counts = {
    trials_seen: 0,
    assigned_email: 0,
    assigned_holdout: 0,
    excluded: {} as Record<string, number>,
    missed: 0,
    sent: { day0: 0, day1: 0 },
    skipped: {} as Record<string, number>,
    errors: [] as string[],
  };
  const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

  // 1. Assign.
  const since = new Date(Math.max(new Date(cfg.started_at).getTime(), now.getTime() - ASSIGN_WINDOW_MS)).toISOString();
  const trials = await fetchNewTrials(since);
  counts.trials_seen = trials.length;
  const already = await assignedIds(trials.map((t) => t.original_transaction_id));
  const fresh = trials.filter((t) => !already.has(t.original_transaction_id));
  const eligible = fresh.filter((t) => {
    if (!isRealUserId(t.app_user_id)) return bump(counts.excluded, "anonymous_id"), false;
    if (!platformOf(t.store)) return bump(counts.excluded, "store"), false;
    return true;
  });
  const prior = await priorBuyers(eligible);
  const users = await consumerUsers([...new Set(eligible.map((t) => t.app_user_id))]);
  for (const t of eligible) {
    if (prior.has(t.app_user_id)) {
      bump(counts.excluded, "earlier_purchase");
      continue;
    }
    const bucket = bucketOf(t.app_user_id);
    const arm = armOf(bucket);
    const u = users.get(t.app_user_id);
    const ok = await insertAssignment({
      original_transaction_id: t.original_transaction_id,
      experiment: EXPERIMENT,
      app_user_id: t.app_user_id,
      arm,
      bucket,
      platform: platformOf(t.store)!,
      product_id: t.product_id,
      trial_start_at: t.event_at,
      email_on_file: !!u?.email,
      journey_stage: u?.glp1_journey_stage ?? null,
    });
    if (!ok) bump(counts.excluded, "already_in_test");
    else if (arm === "email") counts.assigned_email++;
    else counts.assigned_holdout++;
  }

  // 2 + 3. Windows.
  for (const win of sendWindows(now)) {
    counts.missed += await markMissed(win.kind, win.missedBefore);
    const rows = await dueRows(win.kind, win.from, win.to);
    if (!rows.length) continue;
    const people = await consumerUsers([...new Set(rows.map((r) => r.app_user_id))]);
    for (const row of rows) {
      if (!(await claim(row.original_transaction_id, win.kind))) continue;
      const kind = win.kind;
      try {
        const u = people.get(row.app_user_id);
        const status = trialStatus(await trialEvents(row.original_transaction_id), row.trial_start_at);
        const since1h = new Date(new Date(row.trial_start_at).getTime() - 3_600_000).toISOString();
        const act = u ? await activity(u.id, since1h) : { shotLogged: false, sideEffectLogged: false, weightLogged: false };
        const d = decide(kind, status, {
          email: u?.email ?? null,
          displayName: u?.display_name ?? null,
          companionName: u?.companion_name ?? null,
          journeyStage: u?.glp1_journey_stage ?? row.journey_stage,
          language: u?.language ?? null,
          suppressed: u?.email ? await isSuppressed(u.email) : false,
          ...act,
        });
        if (!d.send) {
          await patchAssignment(row.original_transaction_id, { [`${kind}_skip_reason`]: d.reason });
          bump(counts.skipped, `${kind}:${d.reason}`);
          continue;
        }
        const { email, links } = render(
          {
            kind,
            cta: d.cta,
            cancelled: d.cancelled,
            aboutToStart: d.aboutToStart,
            firstName: firstName(u?.display_name),
            fish: fishName(u?.companion_name),
            trialEnd: trialEndLabel(row.trial_start_at, u?.timezone),
            platform: row.platform,
          },
          row.original_transaction_id,
        );
        const messageId = await sendEmail(u!.email!, email, links.unsubscribeUrl);
        await patchAssignment(row.original_transaction_id, {
          [`${kind}_sent_at`]: new Date().toISOString(),
          [`${kind}_variant`]: variantLabel(kind, d),
          [`${kind}_message_id`]: messageId,
        });
        counts.sent[kind]++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        counts.errors.push(`${row.original_transaction_id} ${kind}: ${msg.slice(0, 160)}`);
        await patchAssignment(row.original_transaction_id, { [`${kind}_skip_reason`]: `error: ${msg.slice(0, 120)}` }).catch(() => {});
      }
    }
  }

  return NextResponse.json({ ok: counts.errors.length === 0, enabled: true, ...counts }, { status: counts.errors.length ? 500 : 200 });
}
