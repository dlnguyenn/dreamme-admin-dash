/**
 * Revenue model v2, ported line for line from the vault's
 * wiki/data/revenue-model-v2-2026-11-04.py. PURE.
 *
 * Monthly gross = first payments from this month's trials (77%) and last
 * month's (23%, the 7-day trial lag), plus renewals of every monthly-plan
 * cohort along the RC all-store survival curve, plus quarterly renewals,
 * resubscriptions and the yearly wave. The back-test against RC gross is
 * Aug -1.1%, Sep +3.9%, Oct +3.0%; status quo gives $48,981 for April.
 * tests/forecast.test.ts pins those numbers to the Python.
 *
 * Change the constants here only together with the vault script.
 */

export const MODEL_MONTHS = [
  "2026-07",
  "2026-08",
  "2026-09",
  "2026-10",
  "2026-11",
  "2026-12",
  "2027-01",
  "2027-02",
  "2027-03",
  "2027-04",
  "2027-05",
] as const;

/** RC gross revenue the model was back-tested on. */
export const MODEL_ACTUAL: Record<string, number> = { "2026-08": 42963, "2026-09": 38216, "2026-10": 39450 };

/** First payment per trial (gross) and monthly-plan payers per trial, by source. */
const V1 = { meta: 12.8, org: 16.1 };
const PM = { meta: 0.146, org: 0.157 };
/** 12-month gross value per trial. */
export const V12 = { meta: 18.2, org: 21.7 };
export const NET = 0.84;
/** Share of a month's trial conversions that land next month (7-day trial). */
const LAG = 0.23;

/** Monthly-plan paid cohorts (RC subscription_retention, all stores): size and renewal price. */
const COHORTS: Record<string, [number, number]> = {
  "2026-02": [30, 9.99],
  "2026-03": [152, 9.99],
  "2026-04": [439, 9.99],
  "2026-05": [426, 9.99],
  "2026-06": [750, 9.99],
  "2026-07": [595, 13.9],
  "2026-08": [321, 13.9],
  "2026-09": [345, 14.6],
  "2026-10": [336, 14.6],
};
const SURV = [0.5213, 0.3675, 0.2751, 0.222, 0.191, 0.1691, 0.155, 0.145];
const surv = (k: number) => (k <= SURV.length ? SURV[k - 1] : SURV[SURV.length - 1] * 0.94 ** (k - SURV.length));

const QUARTERLY_REN = 500;
const RESUB = 400;
const YEARLY_REN: Record<string, number> = { "2027-03": 25 * 55 * 0.8, "2027-04": 126 * 55 * 0.8, "2027-05": 147 * 55 * 0.8 };

const idx = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return y * 12 + mo;
};

/** RC trials_new and the self-reported Meta share the model was fitted on. */
export const BASE_TRIALS: Record<string, number> = { "2026-07": 2866, "2026-08": 1916, "2026-09": 2047, "2026-10": 2087 };
export const BASE_META_SHARE: Record<string, number> = { "2026-07": 0.26, "2026-08": 0.36, "2026-09": 0.51, "2026-10": 0.56 };

export interface ModelOptions {
  valueMult?: Record<string, number>;
  convMult?: Record<string, number>;
  survMult?: number;
}

/** Gross revenue per month (Aug 2026 to May 2027) for monthly trials and Meta shares. */
export function runModel(trials: Record<string, number>, metaShare: Record<string, number>, opts: ModelOptions = {}): Record<string, number> {
  const valueMult = opts.valueMult ?? {};
  const convMult = opts.convMult ?? {};
  const survMult = opts.survMult ?? 1;
  const cohorts = new Map<string, [number, number]>(Object.entries(COHORTS));
  const out: Record<string, number> = {};
  MODEL_MONTHS.forEach((m, i) => {
    if (i === 0) return;
    const prev = MODEL_MONTHS[i - 1];
    const v1 = (mm: string) => {
      const s = metaShare[mm];
      return (s * V1.meta + (1 - s) * V1.org) * (valueMult[mm] ?? 1);
    };
    const fresh = (1 - LAG) * trials[m] * v1(m) + LAG * trials[prev] * v1(prev);
    if (!cohorts.has(m)) {
      const pm = (mm: string) => {
        const s = metaShare[mm];
        return (s * PM.meta + (1 - s) * PM.org) * (convMult[mm] ?? 1);
      };
      const payers = (1 - LAG) * trials[m] * pm(m) + LAG * trials[prev] * pm(prev);
      cohorts.set(m, [payers, 14.6 * (valueMult[m] ?? 1)]);
    }
    let ren = 0;
    for (const [c, [n, p]] of cohorts) {
      const k = idx(m) - idx(c);
      if (k >= 1) ren += n * Math.min(1, surv(k) * survMult) * p;
    }
    out[m] = Math.round(fresh + ren + QUARTERLY_REN + RESUB + (YEARLY_REN[m] ?? 0));
  });
  return out;
}

/** Fill every model month: known inputs as given, later months flat at the last known month. */
export function fillForward(known: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  let last: number | undefined;
  for (const m of MODEL_MONTHS) {
    if (known[m] != null) last = known[m];
    if (last != null) out[m] = last;
  }
  return out;
}

/** The plan baseline frozen on 2026-11-04: status quo, October's trials and Meta share held flat. */
export function planBaseline(): Record<string, number> {
  return runModel(fillForward(BASE_TRIALS), fillForward(BASE_META_SHARE));
}

const RAMP: Record<string, number> = { "2026-11": 0.1, "2026-12": 0.25, "2027-01": 0.45, "2027-02": 0.7, "2027-03": 1.0, "2027-04": 1.0, "2027-05": 1.0 };
const FWD = MODEL_MONTHS.slice(4);

/**
 * April gross for the plan: value per trial lifted by `lift` (phased in over
 * four months), clippers adding `extra` non-Meta trials a month by March, Meta
 * held at `meta` trials. Same as the script's sensitivity grid.
 */
export function planApril(lift: number, extra: number, meta = 1100, organic = 990): number {
  const t = { ...BASE_TRIALS };
  const s = { ...BASE_META_SHARE };
  for (const m of FWD) {
    t[m] = Math.round(organic + extra * RAMP[m] + meta);
    s[m] = meta / t[m];
  }
  const vm = Object.fromEntries(FWD.map((m, i) => [m, 1 + (lift - 1) * Math.min(1, (i + 1) / 4)]));
  return runModel(t, s, { valueMult: vm, survMult: lift > 1 ? 1.1 : 1.0 })["2027-04"];
}

export const TARGET_APRIL = 100_000;
/** Jan 15 checkpoint thresholds and the fallback target (vault, Decision). */
export const CHECKPOINT = { date: "2027-01-15", clipperMaxCpt: 15, pricingMinLift: 0.1, resetTarget: 80_000 } as const;
export const DRIFT_RED = 0.1;
