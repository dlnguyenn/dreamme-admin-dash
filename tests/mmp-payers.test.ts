import { describe, expect, it } from "vitest";
import {
  ageRates,
  checkAdSets,
  costPerPayer,
  estimatedTrialToPaid,
  shareOver45,
  summarizeAsc,
  type AgeRateRow,
} from "@/lib/mmp/payers";
import { birthYearOf } from "@/lib/revenue-plan/user-sources";

const row = (age_band: string, trials: number, converted: number, ios = trials, iosConv = converted): AgeRateRow => ({
  age_band,
  trials,
  converted,
  trials_ios: ios,
  converted_ios: iosConv,
});

const RATES = [row("25-34", 100, 20), row("55-64", 100, 50), row("18-24", 10, 9), row("unknown", 100, 30)];

describe("ageRates", () => {
  it("uses a band's own rate only with enough trials", () => {
    const r = ageRates(RATES);
    expect(r.byBand["25-34"]).toBe(0.2);
    expect(r.byBand["55-64"]).toBe(0.5);
    expect(r.byBand["18-24"]).toBeNull(); // 10 trials < 50
    expect(r.overall).toBeCloseTo(109 / 310);
    expect(r.known).toBeCloseTo(210 / 310);
  });

  it("reads the iOS columns when asked", () => {
    const r = ageRates([row("25-34", 100, 20, 60, 30)], { ios: true });
    expect(r.byBand["25-34"]).toBe(0.5);
  });
});

describe("estimatedTrialToPaid", () => {
  const rates = ageRates(RATES);
  it("weights band rates by the ad's age mix", () => {
    expect(estimatedTrialToPaid({ "25-34": 1, "55-64": 1 }, rates)).toBeCloseTo(0.35);
  });
  it("falls back to the overall rate for thin bands", () => {
    expect(estimatedTrialToPaid({ "18-24": 4 }, rates)).toBeCloseTo(rates.overall as number);
  });
  it("is null with no mix", () => {
    expect(estimatedTrialToPaid(undefined, rates)).toBeNull();
    expect(estimatedTrialToPaid({}, rates)).toBeNull();
  });
});

describe("shareOver45", () => {
  it("counts 45-54, 55-64 and 65+", () => {
    expect(shareOver45({ "25-34": 2, "45-54": 1, "65+": 1 })).toBe(0.5);
    expect(shareOver45({})).toBeNull();
  });
});

describe("costPerPayer", () => {
  const rates = { ios: ageRates(RATES, { ios: true }), all: ageRates(RATES) };
  const base = { adset_name: "s", ad_name: "a" };
  const ads = [
    { ...base, ad_id: "old", campaign_name: "Statics (iOS)", spend: 1000, meta_trials: 90, singular_trials: 20 },
    { ...base, ad_id: "young", campaign_name: "Statics (iOS)", spend: 1000, meta_trials: 90, singular_trials: 20 },
    { ...base, ad_id: "android", campaign_name: "Android", spend: 500, meta_trials: 50, singular_trials: 0 },
    { ...base, ad_id: "tiny", campaign_name: "Statics (iOS)", spend: 50, meta_trials: 5, singular_trials: 1 },
  ];
  const mixes = { old: { "55-64": 10 }, young: { "25-34": 10 }, android: { "25-34": 5 } };
  const rows = costPerPayer(ads, mixes, rates);

  it("drops ads under the spend floor", () => {
    expect(rows.map((r) => r.ad_id)).not.toContain("tiny");
  });
  it("ranks the older-skewing ad cheapest per payer", () => {
    expect(rows[0].ad_id).toBe("old");
    expect(rows[0].payers).toBeCloseTo(10);
    expect(rows[0].costPerPayer).toBeCloseTo(100);
    const young = rows.find((r) => r.ad_id === "young")!;
    expect(young.costPerPayer).toBeCloseTo(250);
  });
  it("uses Singular's trials where present, Meta's otherwise", () => {
    expect(rows.find((r) => r.ad_id === "old")!.basis).toBe("singular");
    const android = rows.find((r) => r.ad_id === "android")!;
    expect(android.basis).toBe("meta");
    expect(android.trials).toBe(50);
  });
  it("compares against the average on the same basis only", () => {
    const old = rows.find((r) => r.ad_id === "old")!;
    // singular basis: $2000 / (10 + 4) payers = 142.86 average
    expect(old.vsAverage).toBeCloseTo(100 / (2000 / 14));
    expect(rows.find((r) => r.ad_id === "android")!.vsAverage).toBeCloseTo(1);
  });
});

describe("checkAdSets", () => {
  const w = (adset_id: string, spend: number, clicks: number, installs: number, trials: number) => ({
    adset_id,
    adset_name: adset_id,
    campaign_id: "c",
    campaign_name: "c",
    spend,
    clicks,
    installs,
    trials,
  });
  const out = checkAdSets([w("good", 3000, 1000, 400, 120), w("weak", 600, 1000, 100, 10), w("thin", 40, 100, 5, 1), w("zero", 0.5, 0, 0, 0)]);

  it("skips ad sets with no real spend and sorts by spend", () => {
    expect(out.map((c) => c.adset_id)).toEqual(["good", "weak", "thin"]);
  });
  it("flags rates below the benchmarks", () => {
    const [good, weak, thin] = out;
    expect(good.clickVerdict).toBe("ok");
    expect(good.trialVerdict).toBe("ok");
    expect(good.volumeVerdict).toBe("good");
    expect(weak.clickVerdict).toBe("low"); // 10%
    expect(weak.trialVerdict).toBe("low"); // 10%
    expect(weak.volumeVerdict).toBe("low"); // 10 < 20
    expect(thin.clickVerdict).toBe("thin");
    expect(thin.volumeVerdict).toBe("thin");
  });
  it("judges the rate as shown, in whole percents", () => {
    const [r] = checkAdSets([w("edge", 3000, 1829, 544, 255)]); // 29.7%
    expect(r.clickVerdict).toBe("ok");
  });
});

describe("summarizeAsc", () => {
  it("totals Meta-app referrals against Meta's claim", () => {
    const rows = [
      { bucket: "App Store search", downloads: 3000, last_date: "2026-11-03", meta_ios_installs: 4000 },
      { bucket: "Facebook app", downloads: 4000, last_date: "2026-11-03", meta_ios_installs: 4000 },
      { bucket: "Instagram app", downloads: 1000, last_date: "2026-11-03", meta_ios_installs: 4000 },
    ];
    const s = summarizeAsc(rows);
    expect(s.total).toBe(8000);
    expect(s.fromMetaApps).toBe(5000);
    expect(s.claimRatio).toBe(0.8);
    expect(s.rows[0].bucket).toBe("Facebook app");
    expect(s.lastDate).toBe("2026-11-03");
  });
  it("handles no data", () => {
    expect(summarizeAsc([]).claimRatio).toBeNull();
  });
});

describe("birthYearOf", () => {
  const now = new Date("2026-11-05T00:00:00Z");
  it("keeps plausible birth years", () => {
    expect(birthYearOf("1970-06-02", now)).toBe(1970);
  });
  it("treats the picker default and typos as unknown", () => {
    expect(birthYearOf("1995-01-01", now)).toBeNull();
    expect(birthYearOf("1995-01-01T00:00:00Z", now)).toBeNull();
    expect(birthYearOf("2020-01-01", now)).toBeNull();
    expect(birthYearOf("1900-01-01", now)).toBeNull();
    expect(birthYearOf(null, now)).toBeNull();
  });
});
