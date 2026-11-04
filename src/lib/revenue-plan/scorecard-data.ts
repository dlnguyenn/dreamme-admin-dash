/**
 * Server side of the April Plan scorecard and P&L: month-to-date gross against
 * the plan forecast, model drift, the gap to $100k in April, the Jan 15
 * checkpoints, and the true monthly P&L.
 *
 *  - Actual gross = rc_events charges minus refunds, by UTC month (RC's own
 *    month); it matches RC "Revenue" within 0.5% for Aug-Oct.
 *  - Plan forecast = the model's status quo frozen on 2026-11-04 (forecast.ts).
 *  - Live forecast = the same model fed this month's real trials and Meta
 *    share (the current month projected from its pace), later months flat.
 */
import { loadChaseSummary } from "@/lib/finance/chase-alerts-store";
import { loadClipperTracker } from "./clipper-tracker-data";
import { CHECKPOINT, DRIFT_RED, MODEL_MONTHS, BASE_META_SHARE, BASE_TRIALS, TARGET_APRIL, fillForward, planApril, planBaseline, runModel } from "./forecast";
import { num, sbAll } from "./db";
import { loadExperiments, fetchRefunds } from "./experiments-data";
import { fetchEntries } from "./clipper-tracker-data";
import { buildPnl, type ChaseMonth, type PnlMonth } from "./pnl";
import { sourceGroup } from "./sources";
import { loadSources, sourceStatus } from "./user-sources";
import { fetchCharges, fetchTrialStarts } from "./value-per-trial-data";

/** First month the scorecard reads (the model's first back-tested month). */
const FIRST = "2026-08";

const monthOf = (iso: string) => iso.slice(0, 7);
const monthStart = (m: string) => Date.parse(`${m}-01T00:00:00Z`);
const nextMonth = (m: string) => {
  const d = new Date(monthStart(m));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 7);
};

export interface MonthRow {
  month: string;
  complete: boolean;
  actual: number;
  plan: number | null;
  model: number | null;
  planErr: number | null;
  modelErr: number | null;
}

export interface Checkpoint {
  status: "pass" | "fail" | "pending";
  value: string;
  note: string;
}

export interface ScorecardResponse {
  now: string;
  month: string;
  elapsed: number;
  mtd: { actual: number; planToDate: number | null; planMonth: number | null; projected: number; drift: number | null };
  months: MonthRow[];
  forecast: { month: string; plan: number; live: number }[];
  inputs: { month: string; trials: number; metaShare: number; source: "model" | "actual" | "projected" | "held flat" }[];
  april: { target: number; plan: number; live: number; gap: number };
  grid: { lift: number; extra: number; april: number }[];
  checkpoint: { date: string; daysLeft: number; clipper: Checkpoint; pricing: Checkpoint; resetTarget: number; missed: boolean };
  driftRed: number;
  pnl: PnlMonth[];
  chase: { covered: string[]; note: string | null };
}

let memo: { at: number; value: Promise<ScorecardResponse> } | null = null;

/** Cached 5 minutes: the Scorecard and P&L views share one read. */
export function loadScorecard(now = new Date()): Promise<ScorecardResponse> {
  if (memo && Date.now() - memo.at < 5 * 60_000) return memo.value;
  const value = compute(now);
  memo = { at: Date.now(), value };
  value.catch(() => {
    if (memo?.value === value) memo = null;
  });
  return value;
}

async function compute(now: Date): Promise<ScorecardResponse> {
  const nowIso = now.toISOString();
  const month = monthOf(nowIso);
  const elapsed = (now.getTime() - monthStart(month)) / (monthStart(nextMonth(month)) - monthStart(month));
  const since = new Date(monthStart(FIRST)).toISOString();
  const liveFrom = "2026-11";

  const [charges, refunds, spend, trials, status, entries, chase] = await Promise.all([
    fetchCharges(since),
    fetchRefunds(since),
    sbAll<{ date: string; spend: string | number | null }>("internal", `ad_insights_daily?select=date,spend&date=gte.${FIRST}-01&order=date.asc,ad_id.asc`),
    fetchTrialStarts(new Date(monthStart(liveFrom)).toISOString()),
    sourceStatus(),
    fetchEntries().catch(() => null),
    loadChaseSummary(8).catch(() => null),
  ]);

  const revenue = new Map<string, number>();
  for (const c of [...charges, ...refunds]) {
    const m = monthOf(c.at);
    revenue.set(m, (revenue.get(m) ?? 0) + c.priceUsd);
  }
  const meta = new Map<string, number>();
  for (const s of spend) meta.set(String(s.date).slice(0, 7), (meta.get(String(s.date).slice(0, 7)) ?? 0) + num(s.spend));

  // Model inputs from November on: real trials and self-reported Meta share.
  const sources = await loadSources(trials.map((t) => t.userId ?? ""), status.backend);
  const liveTrials: Record<string, number> = {};
  const liveShare: Record<string, number> = {};
  const inputs: ScorecardResponse["inputs"] = Object.keys(BASE_TRIALS).map((m) => ({ month: m, trials: BASE_TRIALS[m], metaShare: BASE_META_SHARE[m], source: "model" as const }));
  for (let m = liveFrom; m <= month; m = nextMonth(m)) {
    const mine = trials.filter((t) => monthOf(t.at) === m);
    const matched = mine.filter((t) => t.userId && sources.has(t.userId));
    const metaN = matched.filter((t) => sourceGroup(sources.get(t.userId!)) === "meta").length;
    const projected = m === month;
    const n = projected ? (elapsed > 0.02 ? mine.length / elapsed : BASE_TRIALS["2026-10"]) : mine.length;
    liveTrials[m] = Math.round(n);
    liveShare[m] = matched.length ? metaN / matched.length : BASE_META_SHARE["2026-10"];
    inputs.push({ month: m, trials: liveTrials[m], metaShare: liveShare[m], source: projected ? "projected" : "actual" });
  }
  const live = runModel(fillForward({ ...BASE_TRIALS, ...liveTrials }), fillForward({ ...BASE_META_SHARE, ...liveShare }));
  const plan = planBaseline();
  for (const m of MODEL_MONTHS) if (m > month && !inputs.some((i) => i.month === m)) {
    const last = inputs[inputs.length - 1];
    inputs.push({ month: m, trials: last.trials, metaShare: last.metaShare, source: "held flat" });
  }

  const months: MonthRow[] = [];
  for (let m = FIRST; m <= month; m = nextMonth(m)) {
    const complete = m < month;
    const actual = revenue.get(m) ?? 0;
    const p = plan[m] ?? null;
    const md = live[m] ?? null;
    months.push({
      month: m,
      complete,
      actual,
      plan: p,
      model: md,
      planErr: complete && p ? p / actual - 1 : null,
      modelErr: complete && md ? md / actual - 1 : null,
    });
  }
  const mtdActual = revenue.get(month) ?? 0;
  const planMonth = plan[month] ?? null;
  const planToDate = planMonth == null ? null : planMonth * elapsed;

  const grid: ScorecardResponse["grid"] = [];
  for (const lift of [1, 1.2, 1.35]) for (const extra of [800, 1500, 2000, 2600]) grid.push({ lift, extra, april: planApril(lift, extra) });

  // Jan 15 checkpoints.
  const [clip, exps] = await Promise.all([loadClipperTracker(now).catch(() => null), loadExperiments(now).catch(() => null)]);
  const due = now.getTime() >= Date.parse(`${CHECKPOINT.date}T00:00:00Z`);
  const call = clip?.call ?? null;
  const clipper: Checkpoint = !call
    ? { status: due ? "fail" : "pending", value: "no tranche yet", note: "Log the first clipper tranche on the Clippers view." }
    : call.costPerExtraTrial != null && call.costPerExtraTrial <= CHECKPOINT.clipperMaxCpt
      ? { status: "pass", value: `$${call.costPerExtraTrial.toFixed(2)} / extra trial`, note: `week of ${call.week}` }
      : { status: due ? "fail" : "pending", value: call.costPerExtraTrial != null ? `$${call.costPerExtraTrial.toFixed(2)} / extra trial` : "no lift", note: `week of ${call.week}` };
  const price = exps?.find((e) => e.def.id === "price-plan") ?? null;
  const lift = price?.bestRevLift ?? null;
  const pricing: Checkpoint =
    !price || price.status === "draft"
      ? { status: due ? "fail" : "pending", value: "not started", note: "Start the RC price/plan experiment (Experiments view)." }
      : lift != null && lift >= CHECKPOINT.pricingMinLift && price.status !== "collecting"
        ? { status: "pass", value: `+${(lift * 100).toFixed(1)}% revenue / trial`, note: price.message }
        : { status: due ? "fail" : "pending", value: lift == null ? "no read yet" : `${lift >= 0 ? "+" : ""}${(lift * 100).toFixed(1)}% revenue / trial`, note: price.message };

  const pnlMonths: string[] = [];
  for (let m = FIRST; m <= month; m = nextMonth(m)) pnlMonths.push(m);
  const manual = new Map<string, number>();
  for (const e of entries ?? []) manual.set(e.weekStart.slice(0, 7), (manual.get(e.weekStart.slice(0, 7)) ?? 0) + e.payoutsUsd + e.feesUsd);
  const chaseMonths: ChaseMonth[] = chase?.months.map((m) => ({ month: m.month, categories: m.categories })) ?? [];

  return {
    now: nowIso,
    month,
    elapsed,
    mtd: {
      actual: mtdActual,
      planToDate,
      planMonth,
      projected: elapsed > 0.02 ? mtdActual / elapsed : mtdActual,
      drift: planToDate ? mtdActual / planToDate - 1 : null,
    },
    months,
    forecast: MODEL_MONTHS.filter((m) => m >= liveFrom).map((m) => ({ month: m, plan: plan[m], live: live[m] })),
    inputs: inputs.filter((i) => i.month >= FIRST),
    april: { target: TARGET_APRIL, plan: plan["2027-04"], live: live["2027-04"], gap: TARGET_APRIL - live["2027-04"] },
    grid,
    checkpoint: {
      date: CHECKPOINT.date,
      daysLeft: Math.ceil((Date.parse(`${CHECKPOINT.date}T00:00:00Z`) - now.getTime()) / 86_400_000),
      clipper,
      pricing,
      resetTarget: CHECKPOINT.resetTarget,
      missed: clipper.status === "fail" || pricing.status === "fail",
    },
    driftRed: DRIFT_RED,
    pnl: buildPnl(pnlMonths, month, revenue, meta, chaseMonths, manual),
    chase: {
      covered: chaseMonths.map((c) => c.month),
      note: chaseMonths.length
        ? null
        : "The Chase feed has no transactions yet (the Gmail forward filter to dan@dreamme.life isn't set up), so creators and tools are blank and contribution stops at proceeds minus Meta.",
    },
  };
}
