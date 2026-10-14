import { describe, expect, it } from "vitest";
import { STEP_DOWN, easternDate, reportText, summarize, type DayRow, type StepDownConfig } from "@/lib/step-down";

const cfg: StepDownConfig = {
  ...STEP_DOWN,
  transition: "2026-10-14",
  baseline: { from: "2026-10-01", to: "2026-10-13" },
  test: { from: "2026-10-15", to: "2026-10-28" },
};

const day = (date: string, o: Partial<DayRow> = {}): DayRow => ({
  date,
  iosSpend: 700,
  androidSpend: 190,
  iosTrials: 56,
  androidTrials: 14,
  iosSurveyMeta: 30,
  iosSurveyOther: 26,
  ...o,
});

const span = (from: string, to: string, o: (d: string, i: number) => Partial<DayRow> = () => ({})) => {
  const out: DayRow[] = [];
  let i = 0;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000, i++) {
    const d = new Date(t).toISOString().slice(0, 10);
    out.push(day(d, o(d, i)));
  }
  return out;
};

// Baseline with realistic day-to-day noise (sd ~ 6).
const NOISE = [0, 6, -6, 8, -8, 4, -4, 2, -2, 7, -7, 3, -3];
const baseline = span("2026-10-01", "2026-10-13", (_, i) => ({ iosTrials: 56 + NOISE[i] }));
const transition = [day("2026-10-14", { iosSpend: 400, iosTrials: 10 })];
const test = (n: number, iosTrials: number, o: Partial<DayRow> = {}) =>
  span("2026-10-15", new Date(Date.parse("2026-10-15T00:00:00Z") + (n - 1) * 86_400_000).toISOString().slice(0, 10), () => ({
    iosSpend: 200,
    iosTrials,
    ...o,
  }));

describe("summarize", () => {
  it("before the test starts: baseline only, not_started", () => {
    const s = summarize(cfg, [...baseline, ...transition], "2026-10-15");
    expect(s.verdict.status).toBe("not_started");
    expect(s.baseline.days).toBe(13);
    expect(s.baseline.iosTrials).toBe(56);
    expect(s.test.days).toBe(0);
    expect(s.daysTotal).toBe(14);
    expect(s.drop).toBe(0);
    const txt = reportText(s, [...baseline, ...transition]);
    expect(txt).toContain("Test window: 2026-10-15 to 2026-10-28 (14 days).");
    expect(txt).not.toContain("Drop:");
  });

  it("excludes the transition day and today's incomplete day", () => {
    const rows = [...baseline, ...transition, ...test(3, 40), day("2026-10-18", { iosTrials: 0 })];
    const s = summarize(cfg, rows, "2026-10-18");
    expect(s.test.days).toBe(3);
    expect(s.test.iosTrials).toBe(40);
    expect(s.baseline.days).toBe(13);
  });

  it("holds the verdict until minDays complete test days", () => {
    const s = summarize(cfg, [...baseline, ...test(6, 30)], "2026-10-21");
    expect(s.verdict.status).toBe("collecting");
    expect(s.verdict.headline).toContain("Day 6 of 14");
  });

  it("calls 'working' on a drop of 14+/day and prices each lost trial", () => {
    const s = summarize(cfg, [...baseline, ...test(14, 40)], "2026-10-29");
    expect(s.drop).toBe(16);
    expect(s.verdict.status).toBe("working");
    expect(s.spendCut).toBe(500);
    expect(s.costPerLostTrial).toBeCloseTo(31.25);
    expect(s.z).toBeGreaterThan(2);
    expect(s.low).toBeLessThan(16);
    expect(s.high).toBeGreaterThan(16);
  });

  it("calls 'wasted' when trials hold (drop <= 7/day)", () => {
    const s = summarize(cfg, [...baseline, ...test(10, 52)], "2026-10-25");
    expect(s.drop).toBe(4);
    expect(s.verdict.status).toBe("wasted");
    expect(s.costPerLostTrial).toBe(125);
  });

  it("treats a rise in trials as wasted with no cost per lost trial", () => {
    const s = summarize(cfg, [...baseline, ...test(8, 60)], "2026-10-23");
    expect(s.drop).toBe(-4);
    expect(s.verdict.status).toBe("wasted");
    expect(s.costPerLostTrial).toBeNull();
  });

  it("calls 'in_between' for drops between the two rules", () => {
    const s = summarize(cfg, [...baseline, ...test(9, 46)], "2026-10-24");
    expect(s.verdict.status).toBe("in_between");
  });

  it("adjusts the drop for Android's own change (the control)", () => {
    // Android fell 50% with no spend change: half of iOS's fall is not the budget.
    const s = summarize(cfg, [...baseline, ...test(10, 28, { androidTrials: 7 })], "2026-10-25");
    expect(s.androidChange).toBeCloseTo(-0.5);
    expect(s.drop).toBe(28);
    expect(s.dropAndroidAdjusted).toBeCloseTo(0);
  });

  it("reports the survey split when Mixpanel answered for every day, null otherwise", () => {
    const ok = summarize(cfg, [...baseline, ...test(7, 45, { iosSurveyMeta: 20, iosSurveyOther: 25 })], "2026-10-22");
    expect(ok.test.iosSurveyMeta).toBe(20);
    expect(ok.baseline.iosSurveyMeta).toBe(30);
    const rows = [...baseline, ...test(7, 45)];
    rows[3] = { ...rows[3], iosSurveyMeta: null, iosSurveyOther: null };
    expect(summarize(cfg, rows, "2026-10-22").baseline.iosSurveyMeta).toBeNull();
  });
});

describe("reportText", () => {
  it("is plain text with the verdict, both windows, the rules and no em dashes", () => {
    const rows = [...baseline, ...test(8, 40, { androidTrials: 5 })];
    const s = summarize(cfg, rows, "2026-10-23");
    const txt = reportText(s, rows);
    expect(txt.split("\n")[0]).toBe(s.verdict.headline);
    expect(txt).toContain("Baseline (2026-10-01 to 2026-10-13, 13 days)");
    expect(txt).toContain("Test so far (8 of 14 days)");
    expect(txt).toContain("Survey");
    expect(txt).toContain("Warning: Android trials moved");
    expect(txt).toContain("2026-10-22: 40, $200, 5");
    expect(txt).not.toContain("—");
  });
});

describe("easternDate", () => {
  it("buckets instants by US/Eastern day across DST", () => {
    expect(easternDate("2026-10-15T03:59:00Z")).toBe("2026-10-14"); // 23:59 EDT
    expect(easternDate("2026-10-15T04:00:00Z")).toBe("2026-10-15");
    expect(easternDate("2026-11-02T04:30:00Z")).toBe("2026-11-01"); // 23:30 EST
  });
});
