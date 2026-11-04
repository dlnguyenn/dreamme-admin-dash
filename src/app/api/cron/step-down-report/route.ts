/**
 * Daily email for live Meta holdout tests (src/lib/revenue-plan/switchback.ts).
 *
 * Vercel cron, 13:00 UTC (9am Eastern), after sync-ad-insights (07:00) has
 * written yesterday's spend and marketing-alerts (07:45) has checked it
 * against plan. Emails Dan the running verdict and any spend off plan through
 * the dash's operational-alert sender, for every test with status "live",
 * from the day after it starts through the day after it ends (the FINAL
 * readout). Drafts and finished tests stay quiet.
 *
 * ?dry_run=1 returns the email bodies without sending; with ?test=<id> a dry
 * run reads that test whatever its status.
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { mailerConfigured, sendOperationalAlert } from "@/lib/support/mailer";
import { addDays, easternDate } from "@/lib/revenue-plan/dates";
import { internalConfigured } from "@/lib/revenue-plan/db";
import { HOLDOUT_TESTS, findTest, reportText, summarize, testSpan } from "@/lib/revenue-plan/switchback";
import { fetchSwitchbackRows } from "@/lib/revenue-plan/switchback-data";
import { metaBreakEven } from "@/lib/revenue-plan/value-per-trial-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!internalConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const picked = dryRun && url.searchParams.get("test") ? findTest(url.searchParams.get("test")) : null;
  const tests = picked ? [picked] : HOLDOUT_TESTS.filter((t) => t.status === "live");
  const today = easternDate(new Date());
  const results: Record<string, unknown>[] = [];
  try {
    for (const t of tests) {
      const span = testSpan(t);
      const finalDay = addDays(span.to, 1);
      if (!picked && (today <= span.from || today > finalDay)) {
        results.push({ test: t.id, sent: false, reason: "outside the test window" });
        continue;
      }
      const [rows, breakEven] = await Promise.all([fetchSwitchbackRows(t), metaBreakEven()]);
      const summary = summarize(t, rows.days, rows.today, breakEven, rows.names);
      const subject = `${today === finalDay ? "FINAL " : ""}${t.title}: ${summary.verdict.headline}`;
      const bodyText = reportText(summary, rows.days, rows.today) + "\n\nFull view: DAD > Meta Switchback.";
      if (dryRun) {
        results.push({ test: t.id, dry_run: true, subject, bodyText });
        continue;
      }
      if (!mailerConfigured()) {
        return NextResponse.json({ ok: false, error: "DREAMME_SMTP_PASS not set" }, { status: 500 });
      }
      await sendOperationalAlert({ subject, bodyText });
      results.push({ test: t.id, sent: true, subject, status: summary.verdict.status });
    }
    return NextResponse.json({ ok: true, today, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
