/**
 * The experiment watchdog. Runs daily, emails weekly.
 *
 * Every run: reads the experiment log, lets the existing RevenueCat sync move
 * entries that RC has moved, pulls per-variant results for every test that
 * names an RC experiment, and writes one row to experiment_status. That row
 * is what Overview > Experiments reads, so the panel is never older than a
 * day and can say when it was last checked — the "is anything still running?"
 * answer, without a page load calling RevenueCat per test.
 *
 * On Sunday it also emails the digest (src/lib/experiment-health.ts:
 * digestText), so a test that needs a decision cannot sit unnoticed for a
 * week. Vercel cron, 12:40 UTC, which is early Sunday morning Eastern.
 *
 * ?dry_run=1 does everything but write and send, and returns the email.
 * ?force_email=1 sends on any day (for a one-off check).
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { mailerConfigured, sendOperationalAlert } from "@/lib/support/mailer";
import { loadAndSyncExperimentLog } from "@/lib/experiment-log-sync";
import { fetchExperimentResults } from "@/lib/vendors/revenuecat";
import { reduceResults, type RcResultsPayload } from "@/lib/experiment-results";
import {
  buildExperimentHealth,
  digestSubject,
  digestText,
  headline,
  summarize,
  type RcReadout,
} from "@/lib/experiment-health";
import { spPost } from "@/lib/support/db";
import { fetchImpactSeries } from "@/lib/change-impact-data";
import { headlineImpact, sharpest, watchChange } from "@/lib/change-impact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DASH_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://dreamme-admin-dash.vercel.app";

/** Eastern YYYY-MM-DD and day of week (0 = Sunday), the dash's day boundary. */
function easternNow(now: Date): { day: string; weekday: number; clock: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const weekday = new Date(`${parts}T12:00:00Z`).getUTCDay();
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  return { day: parts, weekday, clock };
}

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const forceEmail = url.searchParams.get("force_email") === "1";
  const now = new Date();
  const { day, weekday, clock } = easternNow(now);

  const { entries, rc, rcError } = await loadAndSyncExperimentLog();

  // Results only for entries that could have any: a named RC experiment that
  // has started. One call each, and a failure on one must not lose the rest.
  const readouts: Record<string, RcReadout> = {};
  const resultErrors: Record<string, string> = {};
  const wanted = entries.filter(
    (e) => e.rc_experiment_id && e.status !== "planned" && e.status !== "draft" && rc[e.rc_experiment_id],
  );
  for (const e of wanted) {
    const id = e.rc_experiment_id!;
    if (readouts[id]) continue;
    try {
      readouts[id] = reduceResults((await fetchExperimentResults(id)) as RcResultsPayload);
    } catch (err) {
      resultErrors[id] = err instanceof Error ? err.message : String(err);
    }
  }

  // Shipped changes have no control arm, so each is read against the same
  // metric before and after the day it shipped (lib/change-impact.ts).
  const { series, errors: seriesErrors } = await fetchImpactSeries(now);
  // Only a change that is still live and has a real reading earns a line.
  // An ads change (deliberately not watched), one with no baseline, and one
  // that has already ended belong in the count, not in a list of nine.
  const watches: Record<string, { line: string; early: boolean } | null> = {};
  const changes = entries.filter((e) => e.kind === "change");
  for (const e of changes) {
    if (e.status !== "running") continue;
    const neighbours = changes
      .filter((o) => o.id !== e.id && o.area === e.area && o.start_date)
      .map((o) => o.start_date!);
    const watched = watchChange(e.area, e.start_date, series, neighbours);
    const top = sharpest(watched);
    if (!top || top.verdict === "no_baseline") continue;
    const line = headlineImpact(watched);
    if (line) watches[e.id] = { line, early: top.verdict === "too_early" };
  }

  const healths = buildExperimentHealth({ entries, rc, readouts, rcError, today: day, watches });
  const counts = summarize(healths);
  const summary = {
    headline: headline(counts),
    counts,
    items: healths.map((h) => ({
      id: h.id,
      title: h.title,
      kind: h.kind,
      area: h.area,
      state: h.state,
      stage: h.stage,
      reading: h.reading,
      attention: h.attention,
      days: h.days,
      rcId: h.rcId,
      watch: h.watch,
      watchEarly: h.watchEarly,
    })),
  };

  const isSunday = weekday === 0;
  const shouldEmail = forceEmail || isSunday;
  const subject = digestSubject(healths);
  const bodyText = digestText(healths, {
    checkedAt: `at ${clock} Eastern today`,
    rcError,
    dashUrl: DASH_URL,
  });

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      eastern_day: day,
      would_email: shouldEmail,
      subject,
      bodyText,
      summary,
      rc_error: rcError,
      result_errors: resultErrors,
      series_errors: seriesErrors,
    });
  }

  let emailed = false;
  let emailError: string | null = null;
  if (shouldEmail) {
    if (!mailerConfigured()) emailError = "DREAMME_SMTP_PASS not set";
    else {
      try {
        await sendOperationalAlert({ subject, bodyText });
        emailed = true;
      } catch (err) {
        emailError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  // Written last and always, so a failed email still leaves a fresh panel and
  // the row records that the send failed.
  await spPost("experiment_status", [
    { checked_at: now.toISOString(), summary, emailed, rc_error: rcError ?? emailError },
  ]);

  return NextResponse.json({
    ok: true,
    eastern_day: day,
    emailed,
    email_error: emailError,
    counts,
    rc_error: rcError,
    result_errors: resultErrors,
    series_errors: seriesErrors,
  });
}
