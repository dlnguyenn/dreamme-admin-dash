/**
 * DAD: everything the Trial emails view shows, aggregate only (no emails or
 * user ids leave this route).
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { EXPERIMENT, diffWithCi, perArmNeeded, readDate, type Arm } from "@/lib/trial-emails/core";
import { armStats, getConfig, listAssignments, type ArmStatsRow } from "@/lib/trial-emails/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE = 0.361; // trial-to-paid within 14 days, iOS + Android, Oct 2026 (vault)

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  try {
    const [config, stats, rows] = await Promise.all([getConfig(), armStats(), listAssignments()]);
    const now = new Date();

    const sum = (arm: Arm, platform?: string) => {
      const pick = stats.filter((s) => s.arm === arm && (!platform || s.platform === platform));
      const z = (k: keyof ArmStatsRow) => pick.reduce((a, s) => a + (s[k] as number), 0);
      return {
        assigned: z("assigned"),
        emailOnFile: z("email_on_file"),
        matured48h: z("matured_48h"),
        cancelled48h: z("cancelled_48h"),
        matured7d: z("matured_7d"),
        cancelled7d: z("cancelled_7d"),
        matured14d: z("matured_14d"),
        paid14d: z("paid_14d"),
        refunded14d: z("refunded_14d"),
      };
    };
    const arms = {
      all: { email: sum("email"), holdout: sum("holdout") },
      ios: { email: sum("email", "ios"), holdout: sum("holdout", "ios") },
      android: { email: sum("email", "android"), holdout: sum("holdout", "android") },
    };
    const reads = Object.fromEntries(
      Object.entries(arms).map(([k, a]) => [
        k,
        {
          paid14d: diffWithCi({ n: a.email.matured14d, x: a.email.paid14d }, { n: a.holdout.matured14d, x: a.holdout.paid14d }),
          cancel48h: diffWithCi({ n: a.email.matured48h, x: a.email.cancelled48h }, { n: a.holdout.matured48h, x: a.holdout.cancelled48h }),
        },
      ]),
    );

    // Sends, skips, clicks, unsubscribes (email arm).
    const emailRows = rows.filter((r) => r.arm === "email");
    const sends = (["day0", "day1"] as const).map((kind) => {
      const sentRows = emailRows.filter((r) => r[`${kind}_sent_at`]);
      const skips: Record<string, number> = {};
      for (const r of emailRows) {
        const s = r[`${kind}_skip_reason`];
        if (s) {
          const key = s.startsWith("error") ? "error" : s;
          skips[key] = (skips[key] ?? 0) + 1;
        }
      }
      const variants: Record<string, number> = {};
      for (const r of sentRows) {
        const v = r[`${kind}_variant`] ?? "unknown";
        variants[v] = (variants[v] ?? 0) + 1;
      }
      return {
        kind,
        sent: sentRows.length,
        clicked: emailRows.filter((r) => r[`${kind}_first_click_at`]).length,
        skips,
        variants,
      };
    });
    const unsubscribed = emailRows.filter((r) => r.unsubscribed_at).length;

    // Pace and the first fair read (5-point and 3-point lifts).
    const perArm = Math.min(arms.all.email.assigned, arms.all.holdout.assigned);
    const need5 = perArmNeeded(BASE, 0.05);
    const need3 = perArmNeeded(BASE, 0.03);
    const started = config?.started_at ?? null;
    const days = started ? Math.max(0, (now.getTime() - new Date(started).getTime()) / 86_400_000) : 0;

    // Trials assigned per day (both arms), last 30 days of the test.
    const byDay: Record<string, { email: number; holdout: number }> = {};
    for (const r of rows) {
      const d = r.trial_start_at.slice(0, 10);
      byDay[d] ??= { email: 0, holdout: 0 };
      byDay[d][r.arm]++;
    }

    return NextResponse.json({
      ok: true,
      experiment: EXPERIMENT,
      config,
      now: now.toISOString(),
      arms,
      reads,
      sends,
      unsubscribed,
      pace: {
        days,
        perArmPerDay: days >= 1 ? perArm / days : null,
        need5,
        need3,
        read5: started ? readDate(started, now, perArm, need5) : null,
        read3: started ? readDate(started, now, perArm, need3) : null,
        base: BASE,
      },
      byDay: Object.entries(byDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-30)
        .map(([date, v]) => ({ date, ...v })),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
