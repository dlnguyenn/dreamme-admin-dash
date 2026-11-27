import { describe, expect, it } from "vitest";
import { addDays, campaignWarnings, matchCampaign, readTest, sumRows, type AsaCampaignRow, type AsaDailyRow, type AsaTest } from "@/lib/asa/logic";
import { aggregateRows, newestPerDay, parseTsv } from "@/lib/aso/asc-analytics";
import { buildTermViews, localeVerdict, rankGain } from "@/lib/aso/read";
import { positions, TRACKED_APPS } from "@/lib/aso/ranks";

const camp = (over: Partial<AsaCampaignRow> = {}): AsaCampaignRow => ({
  campaign_id: 1, name: "Test", status: "ENABLED", serving_status: "RUNNING", display_status: null, serving_reasons: [],
  daily_budget: 30, start_time: null, end_time: null, countries: ["US"], deleted: false, synced_at: "", ...over,
});
const day = (d: string, spend: number, campaign_id = 1): AsaDailyRow => ({ day: d, campaign_id, impressions: 10, taps: 2, tap_installs: 1, view_installs: 3, spend });
const test = (over: Partial<AsaTest> = {}): AsaTest => ({
  campaign_id: 1, label: "Drugs", keep_cost_per_trial: 15, stop_cost_per_trial: 25, length_days: 14, checkpoints: [3, 7, 14], started_on: "2026-11-20", notes: "", ...over,
});

describe("Apple Ads campaign warnings", () => {
  it("flags a test that is on with no end date", () => {
    const w = campaignWarnings(camp(), [], true, "2026-11-20");
    expect(w[0].tone).toBe("danger");
  });
  it("does not flag the end date on a non-test campaign", () => {
    expect(campaignWarnings(camp(), [], false, "2026-11-20").some((w) => w.tone === "danger")).toBe(false);
  });
  it("counts days at the daily cap", () => {
    const daily = ["2026-11-10", "2026-11-11", "2026-11-12"].map((d) => day(d, 29));
    const w = campaignWarnings(camp(), daily, false, "2026-11-17");
    expect(w.find((x) => x.tone === "warning")?.text).toContain("3 of the last 14 days");
  });
  it("explains why an enabled campaign isn't serving", () => {
    const w = campaignWarnings(camp({ serving_status: "NOT_RUNNING", serving_reasons: ["NO_AVAILABLE_AD_GROUPS"] }), [], false, "2026-11-17");
    expect(w.at(-1)?.text).toContain("no ad group is on");
  });
});

describe("Apple Ads test read", () => {
  const daily = Array.from({ length: 14 }, (_, i) => day(addDays("2026-11-20", i), 30));
  it("can't count trials before attribution is proven", () => {
    const r = readTest(test(), camp(), daily, null, "2026-11-25");
    expect(r.verdict.tone).toBe("warning");
    expect(r.trials).toBeNull();
  });
  it("is running mid-test and reads spend on actual days", () => {
    const r = readTest(test(), camp(), daily, 5, "2026-11-22");
    expect(r.state).toBe("running");
    expect(r.day).toBe(3);
    expect(r.spend).toBe(90);
    expect(r.pace).toBeCloseTo(1);
  });
  it("keeps at $15 or less per trial after the end", () => {
    const r = readTest(test(), camp(), daily, 28, "2026-12-05");
    expect(r.state).toBe("ended");
    expect(r.cost_per_trial).toBe(15);
    expect(r.verdict.tone).toBe("success");
  });
  it("stops above $25 per trial", () => {
    expect(readTest(test(), camp(), daily, 16, "2026-12-05").verdict.tone).toBe("danger");
  });
  it("calls the middle a judgment", () => {
    expect(readTest(test(), camp(), daily, 20, "2026-12-05").verdict.tone).toBe("warning");
  });
  it("is not started without a start date or any spend", () => {
    expect(readTest(test({ started_on: null }), camp(), [], null, "2026-12-05").state).toBe("not_started");
  });
  it("falls back to the first day with spend when the start wasn't recorded", () => {
    const r = readTest(test({ started_on: null }), camp(), daily, 5, "2026-11-22");
    expect(r.started_on).toBe("2026-11-20");
    expect(r.day).toBe(3);
  });
});

describe("Apple Ads helpers", () => {
  it("sums rows", () => {
    expect(sumRows([day("2026-11-01", 1.234), day("2026-11-02", 2)]).spend).toBe(3.23);
  });
  it("matches a RevenueCat campaign value by id or name", () => {
    const cs = [{ campaign_id: 900001, name: "Example Campaign (US)" }];
    expect(matchCampaign("900001", cs)).toBe(900001);
    expect(matchCampaign("example campaign (us)", cs)).toBe(900001);
    expect(matchCampaign("Other", cs)).toBeNull();
  });
});

describe("App Store Connect analytics", () => {
  const eng = parseTsv(
    "Date\tEvent\tSource Type\tTerritory\tCounts\tUnique Counts\n" +
      "2026-11-01\tImpression\tApp Store search\tUS\t100\t80\n" +
      "2026-11-01\tImpression\tApp Store search\tDE\t10\t9\n" +
      "2026-11-01\tPage view\tApp Store search\tUS\t20\t15\n" +
      "2026-11-01\tTap\tApp Store search\tUS\t5\t5\n",
  );
  it("sums US into both US and ALL, others into ALL", () => {
    const a = aggregateRows(eng, "engagement");
    expect(a.get("2026-11-01|US|App Store search")).toMatchObject({ impressions: 100, impressions_unique: 80, page_views: 20 });
    expect(a.get("2026-11-01|ALL|App Store search")).toMatchObject({ impressions: 110, impressions_unique: 89 });
  });
  it("counts first-time downloads and redownloads only", () => {
    const rows = parseTsv(
      "Date\tDownload Type\tSource Type\tTerritory\tCounts\n" +
        "2026-11-01\tFirst-time download\tApp Store search\tUS\t7\n" +
        "2026-11-01\tRedownload\tApp Store search\tUS\t2\n" +
        "2026-11-01\tAuto-update\tApp Store search\tUS\t50\n",
    );
    expect(aggregateRows(rows, "downloads").get("2026-11-01|US|App Store search")).toMatchObject({ first_downloads: 7, redownloads: 2 });
  });
  it("takes each day from the newest instance, so two-day instances don't double", () => {
    const mk = (d: string, n: number) => aggregateRows(parseTsv(`Date\tEvent\tSource Type\tTerritory\tCounts\tUnique Counts\n${d}\tImpression\tApp Store search\tUS\t${n}\t${n}\n`), "engagement");
    const i1 = mk("2026-11-01", 50); // first, partial
    const i2 = new Map([...mk("2026-11-01", 60), ...mk("2026-11-02", 70)]);
    const out = newestPerDay([{ processingDate: "2026-11-03", agg: i2 }, { processingDate: "2026-11-02", agg: i1 }]);
    expect(out.get("2026-11-01|US|App Store search")?.agg.impressions).toBe(60);
    expect(out.get("2026-11-02|US|App Store search")?.agg.impressions).toBe(70);
  });
});

describe("ASO ranks", () => {
  it("finds tracked apps' positions", () => {
    const p = positions([{ trackId: 1 }, { trackId: TRACKED_APPS.meagain }, { trackId: TRACKED_APPS.dreamme }]);
    expect(p).toEqual({ dreamme: 3, meagain: 2, shotsy: null });
  });
  it("applies the hidden-locale rule", () => {
    expect(localeVerdict(12, true)).toBe("keep");
    expect(localeVerdict(35, true)).toBe("watch");
    expect(localeVerdict(null, true)).toBe("drop");
    expect(localeVerdict(80, true)).toBe("drop");
    expect(localeVerdict(null, false)).toBe("no data");
  });
  it("reports rank gains as places moved up", () => {
    expect(rankGain(11, 4)).toBe(7);
    expect(rankGain(4, 11)).toBe(-7);
    expect(rankGain(null, 4)).toBeNull();
  });
  it("picks baseline, latest and a week ago", () => {
    const row = (d: string, r: number | null) => ({ day: d, term: "wegovy", country: "us", dreamme: r, meagain: 2, shotsy: 4, results_n: 200, source: "cron" });
    const [v] = buildTermViews(
      [{ term: "wegovy", country: "us", term_sets: ["core"], locale_tag: null, position: 1 }],
      [row("2026-11-09", 6), row("2026-11-16", 5), row("2026-11-20", 4), row("2026-11-27", 3)],
    );
    expect(v.baseline?.day).toBe("2026-11-16");
    expect(v.latest?.dreamme).toBe(3);
    expect(v.week_ago?.day).toBe("2026-11-20");
  });
});
