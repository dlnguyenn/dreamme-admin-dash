/**
 * Daily email for the Meta iOS spend step-down test (src/lib/step-down.ts).
 *
 * Vercel cron, 13:00 UTC (9am Eastern), after sync-ad-insights (07:00) has
 * written yesterday's spend. Emails Dan the running verdict through the
 * dash's operational-alert sender. Sends from the transition day through
 * the day after the test ends (the final readout), then goes quiet.
 *
 * ?dry_run=1 returns the email body without sending.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { mailerConfigured, sendOperationalAlert } from "@/lib/support/mailer";
import { STEP_DOWN, fetchStepDownRows, reportText, stepDownDbConfigured, summarize } from "@/lib/step-down";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!stepDownDbConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  }
  const dryRun = new URL(req.url).searchParams.get("dry_run") === "1";
  try {
    const { rows, today } = await fetchStepDownRows(STEP_DOWN);
    const finalDay = addDays(STEP_DOWN.test.to, 1);
    if (!dryRun && (today <= STEP_DOWN.transition || today > finalDay)) {
      return NextResponse.json({ ok: true, sent: false, reason: "outside the test window", today });
    }
    const summary = summarize(STEP_DOWN, rows, today);
    const final = today === finalDay;
    const subject = `${final ? "FINAL " : ""}Step-down test: ${summary.verdict.headline}`;
    const bodyText = reportText(summary, rows) + "\n\nFull view: DAD > Step-down Test.";
    if (dryRun) return NextResponse.json({ ok: true, dry_run: true, subject, bodyText, summary });
    if (!mailerConfigured()) {
      return NextResponse.json({ ok: false, error: "DREAMME_SMTP_PASS not set" }, { status: 500 });
    }
    await sendOperationalAlert({ subject, bodyText });
    return NextResponse.json({ ok: true, sent: true, subject, status: summary.verdict.status });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
