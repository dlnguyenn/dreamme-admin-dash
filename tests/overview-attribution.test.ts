import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAttribution, buildAttributionSeries } from "@/lib/overview";

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

/**
 * The 30-day stepper. The load-bearing rule: each day's baseline is the 7 days
 * immediately before THAT day, never a trailing week anchored to today — which
 * would fold a day into its own baseline and mute the move being looked for.
 */
describe("buildAttributionSeries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("returns the requested number of days, oldest first, today last", () => {
    const s = buildAttributionSeries(many("2026-08-07", "tiktok", 1), NOW, 30);
    expect(s.days).toHaveLength(30);
    expect(s.days[29]).toBe("2026-08-07");
    expect(s.days[0]).toBe("2026-07-09");
  });

  it("anchors each day's baseline to the 7 days before IT", () => {
    const s = buildAttributionSeries(
      [
        ...many("2026-08-05", "tiktok", 10), // the day under test
        ...many("2026-08-04", "tiktok", 3), // inside its baseline
        ...many("2026-07-29", "tiktok", 4), // inside its baseline (7 back)
        ...many("2026-07-28", "tiktok", 99), // 8 back — must be excluded
        ...many("2026-08-06", "tiktok", 50), // AFTER it — must be excluded
      ],
      NOW,
      30,
    );
    const day = s.byDay["2026-08-05"];
    expect(day.todayTotal).toBe(10);
    expect(day.prior7dTotal).toBe(7); // 3 + 4, not 106
  });

  it("aligns shareHistory to days and leaves gaps as null", () => {
    const s = buildAttributionSeries(
      [...many("2026-08-07", "tiktok", 2), ...many("2026-08-05", "tiktok", 4)],
      NOW,
      30,
    );
    const hist = s.shareHistory["tiktok"];
    expect(hist).toHaveLength(s.days.length);
    expect(hist[s.days.indexOf("2026-08-07")]).toBe(100);
    expect(hist[s.days.indexOf("2026-08-05")]).toBe(100);
    // A day with no signups is a gap, not a zero — otherwise the sparkline
    // draws a cliff to the floor for a day we simply have no data for.
    expect(hist[s.days.indexOf("2026-08-06")]).toBe(null);
  });

  it("gives a source a full-length history even when it appears once", () => {
    const s = buildAttributionSeries(
      [
        ...many("2026-08-07", "youtube", 1),
        ...many("2026-08-07", "tiktok", 9),
        ...many("2026-08-06", "tiktok", 10),
      ],
      NOW,
      30,
    );
    expect(s.shareHistory["youtube"]).toHaveLength(s.days.length);
    // Present on 08-06 as a real zero (that day HAD signups, just not this one).
    expect(s.shareHistory["youtube"][s.days.indexOf("2026-08-06")]).toBe(0);
    expect(s.shareHistory["youtube"][s.days.indexOf("2026-08-07")]).toBe(10);
  });

  it("agrees with buildAttribution for today", () => {
    const rows = [
      ...many("2026-08-07", "tiktok", 25),
      ...many("2026-08-07", "facebook", 75),
      ...many("2026-08-06", "tiktok", 70),
      ...many("2026-08-06", "facebook", 30),
    ];
    const s = buildAttributionSeries(rows, NOW, 30);
    expect(s.byDay["2026-08-07"]).toEqual(buildAttribution(rows, NOW));
  });

  it("degrades to empty when the source is unavailable", () => {
    expect(buildAttributionSeries(null, NOW, 30)).toEqual({
      days: [],
      byDay: {},
      shareHistory: {},
    });
  });
});
