/**
 * Estimated cost per payer, per ad (Marcus Burke's method, AGA 2026).
 *
 * Trial-to-paid differs by age, and each ad pulls a different age mix, so an
 * ad's likely trial-to-paid is its age mix weighted by DreamMe's real
 * trial-to-paid per age band (trial_to_paid_by_age, migration 0101). Cost per
 * payer = spend / (trials x that rate). Pure: no fetching here.
 */

export const AGE_BANDS = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** One row of public.trial_to_paid_by_age. */
export interface AgeRateRow {
  age_band: string;
  trials: number;
  converted: number;
  trials_ios: number;
  converted_ios: number;
}

export function toAgeRateRow(raw: Record<string, unknown>): AgeRateRow {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    age_band: String(raw.age_band ?? "unknown"),
    trials: n(raw.trials),
    converted: n(raw.converted),
    trials_ios: n(raw.trials_ios),
    converted_ios: n(raw.converted_ios),
  };
}

/** Bands with fewer trials than this borrow the overall rate. */
export const MIN_BAND_TRIALS = 50;

export interface AgeRates {
  byBand: Record<AgeBand, number | null>;
  overall: number | null;
  /** Share of trials with a usable age. */
  known: number;
}

/** Trial-to-paid per band, from all stores or iOS only. */
export function ageRates(rows: AgeRateRow[], opts: { ios?: boolean } = {}): AgeRates {
  const t = (r: AgeRateRow) => (opts.ios ? r.trials_ios : r.trials);
  const c = (r: AgeRateRow) => (opts.ios ? r.converted_ios : r.converted);
  const total = rows.reduce((a, r) => a + t(r), 0);
  const conv = rows.reduce((a, r) => a + c(r), 0);
  const byBand = Object.fromEntries(
    AGE_BANDS.map((b) => {
      const r = rows.find((x) => x.age_band === b);
      return [b, r && t(r) >= MIN_BAND_TRIALS ? c(r) / t(r) : null];
    }),
  ) as Record<AgeBand, number | null>;
  const knownTrials = rows.filter((r) => (AGE_BANDS as readonly string[]).includes(r.age_band)).reduce((a, r) => a + t(r), 0);
  return { byBand, overall: total > 0 ? conv / total : null, known: total > 0 ? knownTrials / total : 0 };
}

/** Meta's age buckets map 1:1 onto ours; 13-17 and "Unknown" have no rate. */
export function metaAgeBand(metaAge: string): AgeBand | null {
  return (AGE_BANDS as readonly string[]).includes(metaAge) ? (metaAge as AgeBand) : null;
}

/** An ad's trials by age band, as Meta reports them (only the mix is used, not the count). */
export type AgeMix = Partial<Record<AgeBand, number>>;

/**
 * The ad's likely trial-to-paid: its age mix weighted by each band's real
 * rate. Bands without a rate use the overall rate. Null with no mix to read.
 */
export function estimatedTrialToPaid(mix: AgeMix | undefined, rates: AgeRates): number | null {
  if (!mix || rates.overall == null) return null;
  let weight = 0;
  let sum = 0;
  for (const b of AGE_BANDS) {
    const w = mix[b] ?? 0;
    if (w <= 0) continue;
    weight += w;
    sum += w * (rates.byBand[b] ?? rates.overall);
  }
  return weight > 0 ? sum / weight : null;
}

/** Share of the mix aged 45+ (the group Burke would weight up). */
export function shareOver45(mix: AgeMix | undefined): number | null {
  if (!mix) return null;
  const all = AGE_BANDS.reduce((a, b) => a + (mix[b] ?? 0), 0);
  if (all <= 0) return null;
  return ((mix["45-54"] ?? 0) + (mix["55-64"] ?? 0) + (mix["65+"] ?? 0)) / all;
}

export interface PayerInput {
  ad_id: string;
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  spend: number;
  meta_trials: number;
  singular_trials: number;
}

export interface PayerRow extends PayerInput {
  /** Which trial count the estimate rests on. */
  basis: "singular" | "meta";
  trials: number;
  trialToPaid: number | null;
  payers: number | null;
  costPerPayer: number | null;
  over45: number | null;
  /** costPerPayer / the spend-weighted average on the same basis; 1 = average. */
  vsAverage: number | null;
}

/**
 * Cost per payer for every ad with at least `minSpend`. iOS ads use Singular's
 * trials; Android ads use Meta's claims, which run high, so the two bases are
 * compared only within themselves (vsAverage).
 */
export function costPerPayer(
  ads: PayerInput[],
  mixes: Record<string, AgeMix>,
  rates: { ios: AgeRates; all: AgeRates },
  minSpend = 100,
): PayerRow[] {
  const rows: PayerRow[] = ads
    .filter((a) => a.spend >= minSpend)
    .map((a) => {
      // iOS ads always rest on Singular (Meta's iOS claims run ~3x real), even
      // at zero; Android has no Singular coverage, so Meta's count it is.
      const isIos = (a.campaign_name ?? "").includes("(iOS)") || a.singular_trials > 0;
      const basis: PayerRow["basis"] = isIos ? "singular" : "meta";
      const trials = basis === "singular" ? a.singular_trials : a.meta_trials;
      const trialToPaid = estimatedTrialToPaid(mixes[a.ad_id], isIos ? rates.ios : rates.all);
      const payers = trialToPaid != null && trials > 0 ? trials * trialToPaid : null;
      return {
        ...a,
        basis,
        trials,
        trialToPaid,
        payers,
        costPerPayer: payers && payers > 0 ? a.spend / payers : null,
        over45: shareOver45(mixes[a.ad_id]),
        vsAverage: null,
      };
    });
  for (const basis of ["singular", "meta"] as const) {
    const same = rows.filter((r) => r.basis === basis && r.costPerPayer != null);
    const spend = same.reduce((a, r) => a + r.spend, 0);
    const payers = same.reduce((a, r) => a + (r.payers ?? 0), 0);
    const avg = payers > 0 ? spend / payers : null;
    for (const r of same) r.vsAverage = avg ? (r.costPerPayer as number) / avg : null;
  }
  // Grouped by basis (Singular first), cheapest first within each: the bases
  // aren't comparable, so one mixed ranking would mislead.
  const rank = { singular: 0, meta: 1 };
  return rows.sort((a, b) => rank[a.basis] - rank[b.basis] || (a.costPerPayer ?? Infinity) - (b.costPerPayer ?? Infinity));
}

// ---------------------------------------------------------------------------
// Benchmarks (Hannah Parvaz's Meta funnel targets, AGA 2026)
// ---------------------------------------------------------------------------

export const BENCHMARKS = {
  /** Meta click to install: new accounts arrive at 3-6%; aim for ~30%. */
  clickToInstall: 0.3,
  /** Install to trial: over 20%, 25-40% when well optimized. */
  installToTrial: 0.2,
  /** Burke: an ad set needs 20-50 optimization events a week to learn. */
  minWeeklyEvents: 20,
  goodWeeklyEvents: 50,
  /** Below this weekly spend, rates are too noisy to judge. */
  minWeeklySpend: 100,
};

/** One row of public.mmp_adset_week (last 7 full days). */
export interface AdSetWeek {
  adset_id: string;
  adset_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  spend: number;
  clicks: number;
  installs: number;
  trials: number;
}

export function toAdSetWeek(raw: Record<string, unknown>): AdSetWeek {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    adset_id: String(raw.adset_id ?? ""),
    adset_name: raw.adset_name == null ? null : String(raw.adset_name),
    campaign_id: raw.campaign_id == null ? null : String(raw.campaign_id),
    campaign_name: raw.campaign_name == null ? null : String(raw.campaign_name),
    spend: n(raw.spend),
    clicks: n(raw.clicks),
    installs: n(raw.installs),
    trials: n(raw.trials),
  };
}

export type Verdict = "ok" | "low" | "thin";

export interface AdSetCheck extends AdSetWeek {
  clickToInstall: number | null;
  installToTrial: number | null;
  clickVerdict: Verdict;
  trialVerdict: Verdict;
  /** Weekly optimization events: Meta-claimed trial starts. */
  volumeVerdict: "low" | "ok" | "good" | "thin";
}

/** The weekly funnel and volume checks for each ad set. "thin" = too little spend to judge. */
export function checkAdSets(rows: AdSetWeek[], b = BENCHMARKS): AdSetCheck[] {
  return rows
    .filter((r) => r.spend > 1)
    .map((r): AdSetCheck => {
      const thin = r.spend < b.minWeeklySpend;
      const clickToInstall = r.clicks > 0 ? r.installs / r.clicks : null;
      const installToTrial = r.installs > 0 ? r.trials / r.installs : null;
      // Compared as whole percents, as shown: 29.7% reads "30%" and meets a 30% benchmark.
      const verdict = (v: number | null, min: number): Verdict =>
        thin || v == null ? "thin" : Math.round(v * 100) < Math.round(min * 100) ? "low" : "ok";
      return {
        ...r,
        clickToInstall,
        installToTrial,
        clickVerdict: verdict(clickToInstall, b.clickToInstall),
        trialVerdict: verdict(installToTrial, b.installToTrial),
        volumeVerdict: thin ? "thin" : r.trials < b.minWeeklyEvents ? "low" : r.trials < b.goodWeeklyEvents ? "ok" : "good",
      };
    })
    .sort((a, z) => z.spend - a.spend);
}

// ---------------------------------------------------------------------------
// App Store downloads by source (independent of Meta)
// ---------------------------------------------------------------------------

export interface AscSourceRow {
  bucket: string;
  downloads: number;
  last_date: string | null;
  meta_ios_installs: number;
}

export function toAscSourceRow(raw: Record<string, unknown>): AscSourceRow {
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    bucket: String(raw.bucket ?? ""),
    downloads: n(raw.downloads),
    last_date: raw.last_date == null ? null : String(raw.last_date),
    meta_ios_installs: n(raw.meta_ios_installs),
  };
}

export interface AscSummary {
  rows: AscSourceRow[];
  total: number;
  fromMetaApps: number;
  metaClaimed: number;
  /** Meta's claimed iOS installs over first-time downloads that came from Facebook or Instagram. */
  claimRatio: number | null;
  lastDate: string | null;
}

/**
 * First-time iOS downloads by source over 35 days, next to Meta's claimed iOS
 * installs. A download "from the Facebook app" includes organic shares and
 * profile links, so this bounds Meta from above; it is not paid-only.
 */
export function summarizeAsc(rows: AscSourceRow[]): AscSummary {
  const sorted = [...rows].sort((a, b) => b.downloads - a.downloads);
  const total = rows.reduce((a, r) => a + r.downloads, 0);
  const fromMetaApps = rows.filter((r) => r.bucket === "Facebook app" || r.bucket === "Instagram app").reduce((a, r) => a + r.downloads, 0);
  const metaClaimed = rows[0]?.meta_ios_installs ?? 0;
  return {
    rows: sorted,
    total,
    fromMetaApps,
    metaClaimed,
    claimRatio: fromMetaApps > 0 ? metaClaimed / fromMetaApps : null,
    lastDate: rows[0]?.last_date ?? null,
  };
}
