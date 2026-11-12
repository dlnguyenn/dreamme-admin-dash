import { describe, expect, it } from "vitest";
import {
  compareAround,
  headlineImpact,
  watchChange,
  type DayValue,
} from "@/lib/change-impact";

/** A steady series with a given daily value, plus optional noise by index. */
function series(from: string, days: number, value: (i: number) => number | null): DayValue[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => ({
    day: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    value: value(i),
  }));
}

// 40 days from Jun 1; the change lands on Jul 1 (index 30).
const CHANGE_DAY = "2026-07-01";
const wobble = (i: number) => (i % 2 === 0 ? 1 : -1);

describe("before and after a shipped change", () => {
  it("says nothing until a week has passed", () => {
    const s = series("2026-06-01", 33, (i) => 10 + wobble(i));
    const r = compareAround(s, CHANGE_DAY, "cancel_rate");
    expect(r.verdict).toBe("too_early");
    expect(r.daysAfter).toBe(2);
    expect(r.line).toContain("2 days in");
    expect(r.line).toContain("5 more days");
  });

  it("says so when there is no baseline before it", () => {
    const s = series("2026-06-24", 20, () => 10);
    const r = compareAround(s, CHANGE_DAY, "cancel_rate");
    expect(r.verdict).toBe("no_baseline");
    expect(r.line).toContain("not enough history");
  });

  it("calls a small move no clear change", () => {
    // 10 ± 1 before, 10.2 ± 1 after: well inside the swing.
    const s = series("2026-06-01", 50, (i) => (i < 30 ? 10 + wobble(i) : 10.2 + wobble(i)));
    const r = compareAround(s, CHANGE_DAY, "cancel_rate");
    expect(r.verdict).toBe("no_clear_change");
    expect(r.line).toContain("inside the usual day-to-day swing");
    expect(r.caveats).toEqual([]);
  });

  it("flags a move bigger than the usual swing as worth a look", () => {
    // 10 ± 1 before, 6 ± 1 after.
    const s = series("2026-06-01", 50, (i) => (i < 30 ? 10 + wobble(i) : 6 + wobble(i)));
    const r = compareAround(s, CHANGE_DAY, "cancel_rate");
    expect(r.verdict).toBe("worth_a_look");
    expect(r.changePct).toBeGreaterThan(-45);
    expect(r.changePct).toBeLessThan(-35);
    expect(r.line).toMatch(/down 4[01]%/);
    expect(r.line).toContain("further than the usual swing");
    expect(r.line).not.toContain("Worth a proper look");
  });

  it("never claims the change caused it", () => {
    const s = series("2026-06-01", 50, (i) => (i < 30 ? 10 + wobble(i) : 6 + wobble(i)));
    const line = compareAround(s, CHANGE_DAY, "cancel_rate").line;
    expect(line).not.toMatch(/\bworks?\b|\bworking\b|\bcaused\b|\bbecause\b/i);
  });

  it("leaves the change day itself out of both sides", () => {
    // The change day is an outlier; it must not move either average.
    const s = series("2026-06-01", 50, (i) => (i === 30 ? 999 : i < 30 ? 10 : 10));
    const r = compareAround(s, CHANGE_DAY, "cancel_rate");
    expect(r.before).toBe(10);
    expect(r.after).toBe(10);
  });

  it("ignores days with no value", () => {
    const s = series("2026-06-01", 50, (i) => (i % 5 === 0 ? null : 10));
    const r = compareAround(s, CHANGE_DAY, "cancel_rate");
    expect(r.before).toBe(10);
    expect(r.daysBefore).toBeLessThan(30);
  });

  it("keeps each side inside its window", () => {
    const s = series("2026-04-01", 200, () => 10);
    const r = compareAround(s, CHANGE_DAY, "cancel_rate");
    expect(r.daysBefore).toBe(28);
    expect(r.daysAfter).toBe(28);
  });
});

describe("which areas are watched", () => {
  const steady = series("2026-06-01", 50, (i) => (i < 30 ? 10 : 10));

  it("watches a retention change on cancels and saves", () => {
    const w = watchChange("retention", CHANGE_DAY, { cancel_rate: steady, save_redemptions: steady });
    expect(w.impacts.map((i) => i.metric)).toEqual(["cancel_rate", "save_redemptions"]);
    expect(w.silent).toBeNull();
  });

  it("refuses to read an ads change, and says why", () => {
    const w = watchChange("ads", CHANGE_DAY, { trials_per_day: steady });
    expect(w.impacts).toEqual([]);
    expect(w.silent).toContain("spend moves underneath");
    expect(headlineImpact(w)).toContain("Not watched here");
  });

  it("has nothing to say about an area with no daily number", () => {
    const w = watchChange("onboarding", CHANGE_DAY, { trials_per_day: steady });
    expect(w.impacts).toEqual([]);
    expect(w.silent).toBeNull();
    expect(headlineImpact(w)).toBeNull();
  });

  it("says nothing when the change has no start date", () => {
    expect(watchChange("retention", null, { cancel_rate: steady }).impacts).toEqual([]);
  });

  it("leads with the sharpest reading", () => {
    const moved = series("2026-06-01", 50, (i) => (i < 30 ? 10 + wobble(i) : 6 + wobble(i)));
    const flat = series("2026-06-01", 50, (i) => 10 + wobble(i));
    const w = watchChange("retention", CHANGE_DAY, { cancel_rate: flat, save_redemptions: moved });
    expect(headlineImpact(w)).toContain("further than the usual swing");
  });
});

describe("changes that shipped at the same time", () => {
  const moved = series("2026-06-01", 50, (i) => (i < 30 ? 10 + wobble(i) : 6 + wobble(i)));

  it("says a reading cannot tell same-week changes apart", () => {
    const w = watchChange("retention", CHANGE_DAY, { cancel_rate: moved }, ["2026-07-02"]);
    expect(w.impacts[0].caveats.join(" ")).toContain("cannot tell them apart");
    expect(w.impacts[0].caveats.join(" ")).toContain("1 other change");
    expect(headlineImpact(w)).toContain("cannot tell them apart");
  });

  it("counts every colliding change", () => {
    const w = watchChange("retention", CHANGE_DAY, { cancel_rate: moved }, ["2026-07-02", "2026-06-29"]);
    expect(w.impacts[0].caveats.join(" ")).toContain("2 other changes");
  });

  it("leaves a lone change alone", () => {
    const w = watchChange("retention", CHANGE_DAY, { cancel_rate: moved }, ["2026-05-01", "2026-08-20"]);
    expect(w.impacts[0].caveats).toEqual([]);
  });

  it("does not add the caveat to a reading that says nothing yet", () => {
    const short = series("2026-06-01", 32, (i) => 10 + wobble(i));
    const w = watchChange("retention", CHANGE_DAY, { cancel_rate: short }, ["2026-07-02"]);
    expect(w.impacts[0].verdict).toBe("too_early");
    expect(w.impacts[0].caveats).toEqual([]);
  });

  it("reads plainly when no complete day has passed", () => {
    const none = series("2026-06-01", 31, (i) => 10 + wobble(i));
    const r = compareAround(none, CHANGE_DAY, "cancel_rate");
    expect(r.line).toContain("no complete day after it yet");
  });
});

describe("a rate that fell because its denominator grew", () => {
  // The rate drops clearly; the raw count does not move.
  const rateFell = series("2026-06-01", 50, (i) => (i < 30 ? 15 + wobble(i) : 11 + wobble(i)));
  const rawFlat = series("2026-06-01", 50, (i) => 60 + wobble(i));

  it("says the base grew rather than fewer people leaving", () => {
    const w = watchChange("retention", CHANGE_DAY, { cancel_rate: rateFell, cancels_per_day: rawFlat });
    const rate = w.impacts.find((i) => i.metric === "cancel_rate")!;
    expect(rate.verdict).toBe("worth_a_look");
    expect(rate.caveats.join(" ")).toContain("subscriber base growing rather than fewer people leaving");
  });

  it("stays quiet when both the rate and the count moved", () => {
    const rawFell = series("2026-06-01", 50, (i) => (i < 30 ? 60 + wobble(i) : 40 + wobble(i)));
    const w = watchChange("retention", CHANGE_DAY, { cancel_rate: rateFell, cancels_per_day: rawFell });
    const rate = w.impacts.find((i) => i.metric === "cancel_rate")!;
    expect(rate.caveats.join(" ")).not.toContain("subscriber base growing");
  });
});
