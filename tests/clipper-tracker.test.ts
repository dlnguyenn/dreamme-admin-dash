import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/revenue-plan/dates";
import {
  CLIPPER_RULES,
  baselineFrom,
  baselineSpan,
  currentCall,
  trackerWeeks,
  type ClipperWeekEntry,
  type WeekCounts,
} from "@/lib/revenue-plan/clipper-tracker";

const FIRST = "2026-09-07"; // Monday
const weeks = (n: number, over: (i: number) => Partial<WeekCounts> = () => ({})): WeekCounts[] =>
  Array.from({ length: n }, (_, i) => ({
    week: addDays(FIRST, 7 * i),
    complete: true,
    onboardings: 1600,
    tiktokOnboardings: 240,
    trials: 450,
    metaTrials: 230,
    tiktokTrials: 70,
    nonMetaTrials: 220,
    ...over(i),
  }));
const entry = (weekStart: string, payoutsUsd: number, feesUsd = 0, viewsBought: number | null = null): ClipperWeekEntry => ({
  weekStart,
  viewsBought,
  payoutsUsd,
  feesUsd,
  tranche: "T1",
  note: null,
});

describe("baseline", () => {
  it("uses the six complete weeks before the first spend week", () => {
    const counts = weeks(10);
    const span = baselineSpan(counts, [entry(addDays(FIRST, 56), 1500)])!; // spend starts in week 9
    expect(span.from).toBe(addDays(FIRST, 14));
    expect(span.to).toBe(addDays(FIRST, 55));
    const b = baselineFrom(counts, span);
    expect(b.weeks).toBe(6);
    expect(b.nonMetaTrials).toBe(220);
  });

  it("before any spend, reads the latest six complete weeks", () => {
    const counts = weeks(8, (i) => ({ complete: i < 7 }));
    const span = baselineSpan(counts, [])!;
    expect(span.from).toBe(addDays(FIRST, 7));
    expect(span.to).toBe(addDays(FIRST, 7 * 6 + 6));
  });
});

describe("stop rule", () => {
  const counts = weeks(12, (i) =>
    // weeks 6..11 carry spend; extra non-Meta trials vary
    ({ nonMetaTrials: [220, 220, 220, 220, 220, 220, 420, 320, 300, 300, 220, 220][i], tiktokTrials: 70 + Math.max(0, [0, 0, 0, 0, 0, 0, 100, 50, 40, 40, 0, 0][i]) }),
  );
  const spendWeeks = [6, 7, 8, 9, 10];
  const entries = spendWeeks.map((i) => entry(addDays(FIRST, 7 * i), 2000, 400, 1_200_000));
  const base = baselineFrom(counts, baselineSpan(counts, entries)!);
  const out = trackerWeeks(counts, entries, base);
  const at = (i: number) => out[i];

  it("costs a week's spend against its extra non-Meta trials", () => {
    expect(base.nonMetaTrials).toBe(220);
    expect(at(6).extraNonMetaTrials).toBe(200);
    expect(at(6).costPerExtraTrial).toBeCloseTo(12); // $2,400 / 200
    expect(at(6).costPerExtraTiktokTrial).toBeCloseTo(24); // strict bound: 100 extra TikTok trials
    expect(at(6).costPer1kViews).toBeCloseTo(2);
  });

  it("doubles at $15 or less, holds in between, flags over $18, pauses on two in a row", () => {
    expect(at(6).status).toBe("double"); // $12
    expect(at(7).status).toBe("over"); // $2,400 / 100 = $24
    expect(at(8).status).toBe("pause"); // $30, second week running
    expect(at(9).status).toBe("pause"); // still over
    expect(at(10).status).toBe("pause"); // no lift counts as over
    expect(at(11).status).toBe("no_spend");
  });

  it("holds between $15 and $18 and resets the streak", () => {
    const c = weeks(9, (i) => ({ nonMetaTrials: [220, 220, 220, 220, 220, 220, 120 + 220, 220 + 140, 220 + 100][i] }));
    const e = [6, 7, 8].map((i) => entry(addDays(FIRST, 7 * i), 2400));
    const w = trackerWeeks(c, e, baselineFrom(c, baselineSpan(c, e)!));
    expect(w[6].status).toBe("over"); // $20
    expect(w[7].status).toBe("hold"); // $17.14
    expect(w[8].status).toBe("over"); // $24, but the previous week was a hold
  });

  it("leaves the week in progress pending and calls the latest judged week", () => {
    const c = weeks(8, (i) => ({ complete: i < 7, nonMetaTrials: i >= 6 ? 400 : 220 }));
    const e = [entry(addDays(FIRST, 42), 1800), entry(addDays(FIRST, 49), 900)];
    const w = trackerWeeks(c, e, baselineFrom(c, baselineSpan(c, e)!));
    expect(w[7].status).toBe("pending");
    expect(currentCall(w)!.week).toBe(addDays(FIRST, 42));
    expect(currentCall(w)!.status).toBe("double");
  });

  it("matches the vault's thresholds", () => {
    expect(CLIPPER_RULES.pauseAbove).toBe(18);
    expect(CLIPPER_RULES.doubleAtOrBelow).toBe(15);
  });
});
