import { describe, expect, it } from "vitest";
import { daysBetween } from "@/lib/revenue-plan/dates";
import {
  HOLDOUT_TESTS,
  adjustedEstimate,
  findTest,
  planDeviations,
  rawEstimate,
  summarize,
  type HoldoutTest,
  type SwitchbackDay,
} from "@/lib/revenue-plan/switchback";

const IOS = "120249101441350622";
const TESTING = "120249182914140622";
const ANDROID = "120249131433200622";

const day = (date: string, o: Partial<SwitchbackDay> = {}): SwitchbackDay => ({
  date,
  spend: {},
  iosSpend: 0,
  androidSpend: 190,
  iosTrials: 40,
  androidTrials: 13,
  iosMetaReported: 60,
  iosSaidMeta: 20,
  iosSaidOther: 20,
  ...o,
});

// A four-week switchback, budgets switched at midnight.
const TEST: HoldoutTest = {
  id: "t",
  title: "Test switchback",
  status: "live",
  summary: "",
  campaigns: [
    { id: IOS, name: "SCALING Campaign (iOS)", platform: "ios" },
    { id: TESTING, name: "TESTING Campaign (iOS)", platform: "ios" },
    { id: ANDROID, name: "SCALING Campaign (Android)", platform: "android" },
  ],
  phases: [
    { from: "2026-11-16", to: "2026-11-22", arm: "high", budgets: { [IOS]: 700, [TESTING]: 0, [ANDROID]: 190 } },
    { from: "2026-11-23", to: "2026-11-29", arm: "low", budgets: { [IOS]: 200, [TESTING]: 0, [ANDROID]: 190 } },
    { from: "2026-11-30", to: "2026-12-06", arm: "high", budgets: { [IOS]: 700, [TESTING]: 0, [ANDROID]: 190 } },
    { from: "2026-12-07", to: "2026-12-13", arm: "low", budgets: { [IOS]: 200, [TESTING]: 0, [ANDROID]: 190 } },
  ],
  minDaysPerArm: 14,
  maxRelHalfWidth: 0.25,
  extendWeeks: 2,
};
const armOf = (d: string) => TEST.phases.find((p) => d >= p.from && d <= p.to)!.arm;
const NOISE = [3, -2, 4, -5, 1, -1, 2, -3, 5, -4, 0, 2, -2, 1];

/** Days on plan: iOS trials = base + effect on high days + noise; Android shares a common shock. */
function onPlan(effect: number, noiseScale = 1, base = 36): SwitchbackDay[] {
  return daysBetween("2026-11-16", "2026-12-13").map((d, i) => {
    const high = armOf(d) === "high";
    const shock = i % 7 === 5 ? 6 : 0; // a weekly common swing both platforms feel
    const spend = high ? 700 : 200;
    return day(d, {
      spend: { [IOS]: spend, [ANDROID]: 190 },
      iosSpend: spend,
      iosTrials: base + (high ? effect : 0) + noiseScale * NOISE[i % NOISE.length] + shock,
      androidTrials: 13 + Math.round(shock / 3),
    });
  });
}

describe("planDeviations", () => {
  it("flags >20% off as warn, >50% as critical, and any spend on a $0 campaign", () => {
    const days = [
      day("2026-11-16", { spend: { [IOS]: 700, [ANDROID]: 190 } }), // on plan
      day("2026-11-17", { spend: { [IOS]: 850, [ANDROID]: 190 } }), // +21%
      day("2026-11-24", { spend: { [IOS]: 736, [ANDROID]: 190 } }), // low arm back at ~$700: the October break
      day("2026-11-25", { spend: { [IOS]: 200, [TESTING]: 145, [ANDROID]: 190 } }), // paused campaign spending
      day("2026-11-26", { spend: { [IOS]: 200, [ANDROID]: 190, other: 50 } }), // campaign not in the plan
    ];
    const devs = planDeviations(TEST, days, "2026-12-01", { other: "EAC Leads (iOS) website" });
    expect(devs.map((d) => [d.date, d.campaignId, d.severity])).toEqual([
      ["2026-11-17", IOS, "warn"],
      ["2026-11-24", IOS, "critical"],
      ["2026-11-25", TESTING, "critical"],
      ["2026-11-26", "other", "warn"],
    ]);
    expect(devs[1].message).toContain("$736");
    expect(devs[1].message).toContain("+268%");
    expect(devs[3].message).toContain("EAC Leads (iOS) website");
  });

  it("ignores today, days outside the phases and excluded days", () => {
    const t = { ...TEST, excludeDays: ["2026-11-18"] };
    const days = [
      day("2026-11-10", { spend: { [IOS]: 999 } }),
      day("2026-11-18", { spend: { [IOS]: 999 } }),
      day("2026-11-19", { spend: { [IOS]: 999 } }),
    ];
    expect(planDeviations(t, days, "2026-11-19")).toEqual([]);
  });

  it("would have caught the October step-down breaking on Oct 16", () => {
    const oct = findTest("ios-stepdown-2026-10")!;
    const spend = { "2026-10-15": 185, "2026-10-16": 736, "2026-10-17": 656 } as Record<string, number>;
    const days = Object.entries(spend).map(([d, v]) => day(d, { spend: { [IOS]: v, [ANDROID]: 190 } }));
    const devs = planDeviations(oct, days, "2026-11-04");
    expect(devs.map((d) => d.date)).toEqual(["2026-10-16", "2026-10-17"]);
    expect(devs.every((d) => d.severity === "critical")).toBe(true);
  });
});

describe("estimates", () => {
  it("raw estimate: difference in means with a pooled standard error", () => {
    const high = [50, 52, 48, 50].map((n, i) => day(`2026-11-1${6 + i}`, { iosTrials: n }));
    const low = [30, 32, 28, 30].map((n, i) => day(`2026-11-2${3 + i}`, { iosTrials: n }));
    const e = rawEstimate(high, low)!;
    expect(e.effect).toBeCloseTo(20);
    // pooled variance 8/3, se = sqrt(8/3 * (1/4 + 1/4))
    expect(e.se).toBeCloseTo(Math.sqrt((8 / 3) * 0.5));
  });

  it("Android adjustment recovers the effect and removes shared swings", () => {
    const days = onPlan(15);
    const high = days.filter((d) => armOf(d.date) === "high");
    const low = days.filter((d) => armOf(d.date) === "low");
    const adj = adjustedEstimate(high, low)!;
    const raw = rawEstimate(high, low)!;
    expect(adj.effect).toBeGreaterThan(12);
    expect(adj.effect).toBeLessThan(18);
    expect(adj.se).toBeLessThan(raw.se);
  });

  it("needs two days per arm", () => {
    expect(rawEstimate([day("2026-11-16")], [day("2026-11-23"), day("2026-11-24")])).toBeNull();
    expect(adjustedEstimate([day("2026-11-16")], [day("2026-11-23"), day("2026-11-24")])).toBeNull();
  });
});

describe("summarize verdicts", () => {
  const be = { value: 15.3, basis: "test" };

  it("drafts are shown, never judged", () => {
    const s = summarize({ ...TEST, status: "draft" }, onPlan(30), "2026-12-20", be);
    expect(s.verdict.status).toBe("draft");
  });

  it("collects until the last phase is over", () => {
    const s = summarize(TEST, onPlan(30), "2026-12-01", be);
    expect(s.verdict.status).toBe("collecting");
    expect(s.daysTotal).toBe(28);
  });

  it("keeps high spend when even the worst case is under break-even", () => {
    // $500/day buys ~45 extra trials: about $11 each.
    const s = summarize(TEST, onPlan(45), "2026-12-14", be);
    expect(s.cpt).toBeGreaterThan(9);
    expect(s.cpt).toBeLessThan(13);
    expect(s.verdict.status).toBe("keep_high");
  });

  it("runs low when even the best case is above break-even", () => {
    // ~12 extra trials for $500/day is ~$42 each.
    const s = summarize(TEST, onPlan(12), "2026-12-14", be);
    expect(s.verdict.status).toBe("run_low");
  });

  it("extends when the interval is wide and straddles break-even", () => {
    // ~30 extra trials (~$16) with heavy noise.
    const s = summarize(TEST, onPlan(30, 6), "2026-12-14", be);
    expect(s.cptLow!).toBeLessThan(be.value);
    expect(s.cptHigh!).toBeGreaterThan(be.value);
    expect(s.verdict.status).toBe("extend");
  });

  it("gives no read when the arms spent the same", () => {
    const flat = onPlan(0).map((d) => ({ ...d, iosSpend: 500, spend: { [IOS]: 500 } }));
    expect(summarize(TEST, flat, "2026-12-14", be).verdict.status).toBe("invalid");
  });

  it("gives no read when the low arm drifted back up, as in October", () => {
    // Planned gap $500/day; the low weeks actually ran at $600.
    const drifted = onPlan(20).map((d) => (armOf(d.date) === "low" ? { ...d, iosSpend: 600, spend: { [IOS]: 600, [ANDROID]: 190 } } : d));
    const s = summarize(TEST, drifted, "2026-12-14", be);
    expect(s.plannedSpendDelta).toBeCloseTo(500);
    expect(s.spendDelta).toBeCloseTo(100);
    expect(s.verdict.status).toBe("invalid");
    expect(s.verdict.headline).toContain("plan broke");
  });

  it("scores an observed baseline by its actual spend, and never flags it", () => {
    const oct = findTest("ios-stepdown-2026-10")!;
    const days = daysBetween("2026-10-01", "2026-10-28").map((d) =>
      d <= "2026-10-13"
        ? day(d, { iosSpend: 715, spend: { [IOS]: 475, other: 240 } })
        : day(d, { iosSpend: 664, spend: { [IOS]: d >= "2026-10-16" ? 700 : 200 } }),
    );
    const s = summarize(oct, days, "2026-11-04", be);
    expect(s.deviations.every((x) => x.date >= "2026-10-15")).toBe(true);
    expect(s.plannedSpendDelta).toBeCloseTo(715 - 200);
    expect(s.verdict.status).toBe("invalid");
  });

  it("ships a valid draft switchback and the October history", () => {
    const sb = findTest("ios-switchback-2026-11")!;
    expect(sb.status).toBe("draft");
    expect(sb.phases.map((p) => p.arm)).toEqual(["high", "low", "high", "low"]);
    for (const p of sb.phases) expect(Object.keys(p.budgets)).toContain(IOS);
    expect(HOLDOUT_TESTS.every((t) => t.phases.every((p) => p.from <= p.to))).toBe(true);
  });
});
