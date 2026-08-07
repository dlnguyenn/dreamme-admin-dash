import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAttribution } from "@/lib/overview";

/**
 * Source attribution: today's self-reported mix vs the prior 7 complete days.
 *
 * The comparison is on SHARE, not counts, because today is always a partial
 * day — at 3pm Eastern every raw count sits well below a full-day average, so
 * comparing counts would flag every source as collapsing every afternoon.
 * These tests pin that, plus the day-boundary handling.
 */
const NOW = new Date("2026-08-07T18:00:00Z"); // 2pm ET → today = 08-07

/** Eastern noon on `day`, i.e. unambiguously inside that Eastern date. */
const at = (day: string, source: string | null) => ({
  joined_at: `${day}T16:00:00Z`,
  referral_source: source,
});

const many = (day: string, source: string | null, n: number) =>
  Array.from({ length: n }, () => at(day, source));

describe("buildAttribution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("splits today from the prior 7 days and computes both shares", () => {
    const a = buildAttribution([
      ...many("2026-08-07", "tiktok", 25),
      ...many("2026-08-07", "facebook", 75),
      ...many("2026-08-06", "tiktok", 70),
      ...many("2026-08-06", "facebook", 30),
    ]);
    const tiktok = a.rows.find((r) => r.source === "tiktok")!;
    expect(tiktok.today).toBe(25);
    expect(tiktok.prior7dTotal).toBe(70);
    expect(tiktok.todaySharePct).toBe(25);
    expect(tiktok.priorSharePct).toBe(70);
    expect(a.todayTotal).toBe(100);
    expect(a.prior7dTotal).toBe(100);
  });

  it("averages the baseline over 7 days, not over days seen", () => {
    // 70 signups on a single prior day is still 10/day against the window.
    const a = buildAttribution(many("2026-08-06", "tiktok", 70));
    expect(a.rows[0].avgPerDay).toBe(10);
  });

  /**
   * The real 2026-08-07 case: youtube appeared with 1 signup today and none
   * in the prior week. A hardcoded source list would have dropped it.
   */
  it("includes a source that is brand new today", () => {
    const a = buildAttribution([
      ...many("2026-08-07", "youtube", 1),
      ...many("2026-08-06", "tiktok", 99),
      ...many("2026-08-07", "tiktok", 9),
    ]);
    const yt = a.rows.find((r) => r.source === "youtube");
    expect(yt).toBeDefined();
    expect(yt!.prior7dTotal).toBe(0);
    expect(yt!.priorSharePct).toBe(0);
    expect(yt!.todaySharePct).toBe(10);
  });

  it("keeps a source that has dried up today", () => {
    const a = buildAttribution([
      ...many("2026-08-06", "google", 14),
      ...many("2026-08-07", "tiktok", 5),
    ]);
    const g = a.rows.find((r) => r.source === "google")!;
    expect(g.today).toBe(0);
    expect(g.todaySharePct).toBe(0);
    expect(g.avgPerDay).toBe(2);
  });

  it("excludes days older than the 7-day window", () => {
    const a = buildAttribution([
      ...many("2026-07-30", "tiktok", 500), // 8 days back — outside
      ...many("2026-07-31", "tiktok", 7), // 7 days back — inside
    ]);
    expect(a.prior7dTotal).toBe(7);
  });

  it("counts skipped answers for coverage but keeps them out of shares", () => {
    const a = buildAttribution([
      ...many("2026-08-07", "tiktok", 8),
      ...many("2026-08-07", null, 2),
    ]);
    expect(a.unansweredToday).toBe(2);
    expect(a.todayTotal).toBe(8); // share denominator excludes them
    expect(a.rows[0].todaySharePct).toBe(100);
    expect(a.coveragePct).toBe(80); // 8 answered of 10 signups
  });

  it("normalizes casing and whitespace so one source isn't split in two", () => {
    const a = buildAttribution([
      at("2026-08-07", "TikTok"),
      at("2026-08-07", " tiktok "),
    ]);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].today).toBe(2);
  });

  it("sorts by today's volume so the panel scans top-down", () => {
    const a = buildAttribution([
      ...many("2026-08-07", "instagram", 3),
      ...many("2026-08-07", "tiktok", 20),
      ...many("2026-08-07", "facebook", 9),
    ]);
    expect(a.rows.map((r) => r.source)).toEqual([
      "tiktok",
      "facebook",
      "instagram",
    ]);
  });

  /** Just after Eastern midnight there is no data yet; nothing may divide. */
  it("returns null shares rather than dividing by zero", () => {
    const a = buildAttribution(many("2026-08-06", "tiktok", 5));
    expect(a.todayTotal).toBe(0);
    expect(a.rows[0].todaySharePct).toBe(null);
    expect(a.coveragePct).toBe(null);
  });

  it("degrades to empty when the source is unavailable", () => {
    expect(buildAttribution(null)).toMatchObject({
      rows: [],
      todayTotal: 0,
      coveragePct: null,
    });
  });
});
