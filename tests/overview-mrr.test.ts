import { describe, expect, it } from "vitest";
import { buildMrr, type MrrRow } from "@/lib/overview-mrr";

const DAY = 86_400_000;
const iso = (start: string, n: number) =>
  new Date(Date.parse(`${start}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** 100 complete days of MRR growing $100/day from $20,000, then a partial "today". */
function rows(): MrrRow[] {
  const out: MrrRow[] = [];
  for (let i = 0; i < 100; i++) {
    // Faster growth in the first half so the 30-day rate is slowing.
    const mrr = i < 40 ? 20_000 + i * 150 : 20_000 + 40 * 150 + (i - 40) * 100;
    out.push({ date: iso("2026-08-01", i), mrr, active_subscriptions: 2000 + i * 10, synced_at: "2026-11-09T07:58:00Z" });
  }
  // Partial today: the sync ran on this UTC day.
  out.push({ date: "2026-11-09", mrr: 26_000 + 59 * 100 + 30, active_subscriptions: 3000, synced_at: "2026-11-09T07:58:00Z" });
  return out;
}

describe("buildMrr", () => {
  it("measures changes between complete days, not the partial newest row", () => {
    const m = buildMrr(rows())!;
    // 2026-08-01 + 99 days = 2026-11-08
    expect(m.lastDay?.date).toBe("2026-11-08");
    expect(m.lastDay?.change).toBe(100);
    expect(m.latestIsPartial).toBe(true);
    expect(m.todaySoFar).toBe(30);
    expect(m.mrr).toBe(31_930);
    expect(m.arr).toBe(31_930 * 12);
  });

  it("reports 7 and 30 day growth with the prior window", () => {
    const m = buildMrr(rows())!;
    expect(m.d7?.change).toBe(700);
    expect(m.d7?.perDay).toBe(100);
    expect(m.d30?.change).toBe(3000);
    // Prior 30d window (day 39 to 69) has one $150 day, then $100/day.
    expect(m.d30?.priorChange).toBe(150 + 29 * 100);
    expect(m.d30!.pct).toBeLessThan(m.d30!.priorPct! + 1e-9);
  });

  it("builds a 60-day chart with 7-day averages and a 30-day growth line", () => {
    const m = buildMrr(rows())!;
    expect(m.daily).toHaveLength(60);
    expect(m.daily.at(-1)?.avg7).toBe(100);
    expect(m.growth).toHaveLength(60);
    // Growth rate falls over the window because the base grows while $/day doesn't.
    expect(m.growth[0].pct30).toBeGreaterThan(m.growth.at(-1)!.pct30);
    expect(m.upDays30).toBe(30);
  });

  it("projects the next $5k milestone at the 30-day pace", () => {
    const m = buildMrr(rows())!;
    expect(m.milestone?.target).toBe(35_000);
    expect(m.milestone?.days).toBe(Math.ceil((35_000 - 31_930) / 100));
  });

  it("returns null with no usable rows", () => {
    expect(buildMrr([{ date: "2026-11-01", mrr: null, active_subscriptions: null }])).toBeNull();
  });
});
