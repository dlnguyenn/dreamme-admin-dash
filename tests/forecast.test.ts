import { describe, expect, it } from "vitest";
import { BASE_META_SHARE, BASE_TRIALS, fillForward, planApril, planBaseline, runModel } from "@/lib/revenue-plan/forecast";

// Outputs of wiki/data/revenue-model-v2-2026-11-04.py, run 2026-11-04.
describe("revenue model v2 port", () => {
  it("reproduces the back-test and the status quo", () => {
    const r = planBaseline();
    expect(r["2026-08"]).toBeCloseTo(42497, -1);
    expect(r["2026-09"]).toBeCloseTo(39708, -1);
    expect(r["2026-10"]).toBeCloseTo(40628, -1);
    expect(r["2026-11"]).toBeCloseTo(41207, -1);
    expect(r["2027-01"]).toBeCloseTo(42054, -1);
    expect(r["2027-04"]).toBeCloseTo(48981, -1);
    expect(r["2027-05"]).toBeCloseTo(50326, -1);
  });

  it("reproduces scenario B (Meta off, nothing else)", () => {
    const t = { ...BASE_TRIALS };
    const s = { ...BASE_META_SHARE };
    for (const m of ["2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05"]) {
      t[m] = 990;
      s[m] = 0;
    }
    expect(runModel(t, s)["2027-04"]).toBeCloseTo(31609, -1);
  });

  it("reproduces the plan grid", () => {
    expect(planApril(1.0, 1500) / 1000).toBeCloseTo(77, 0);
    expect(planApril(1.35, 1500) / 1000).toBeCloseTo(100, 0);
    expect(planApril(1.35, 800) / 1000).toBeCloseTo(83, 0);
    expect(planApril(1.2, 2000) / 1000).toBeCloseTo(102, 0);
  });

  it("fills later months flat from the last known month", () => {
    expect(fillForward({ "2026-07": 1, "2026-09": 3 })).toMatchObject({ "2026-07": 1, "2026-08": 1, "2026-09": 3, "2027-05": 3 });
  });
});
