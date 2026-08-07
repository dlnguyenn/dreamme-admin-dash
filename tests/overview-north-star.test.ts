import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildNorthStar } from "@/lib/overview";

/**
 * Regression cover for the north-star tile.
 *
 * The bug this guards against, observed live on 2026-08-05: trial starts were
 * read from rc_account_metrics_daily, whose newest row is written mid-day by a
 * once-daily cron. Yesterday showed 29 against a 76.3 prior-week average — a
 * "-62%" crash that was purely the sync timestamp. The tile now reads
 * rc_trial_starts_daily (event-sourced from the RC webhook) and excludes the
 * still-accumulating current day from the headline, the average and the spark.
 */
const NOW = new Date("2026-08-05T09:00:00Z"); // today = 08-05, yesterday = 08-04

const series = (...pairs: [string, number][]) =>
  pairs.map(([date, trial_starts]) => ({ date, trial_starts }));

describe("buildNorthStar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("reports yesterday, not the newest row", () => {
    const ns = buildNorthStar(
      series(
        ["2026-08-01", 70],
        ["2026-08-02", 80],
        ["2026-08-03", 79],
        ["2026-08-04", 81],
        ["2026-08-05", 22], // today, still accumulating
      ),
    );
    expect(ns.trialStartsYesterday).toBe(81);
    expect(ns.trialStartsToday).toBe(22);
    expect(ns.date).toBe("2026-08-04");
  });

  it("keeps today out of the average and the sparkline", () => {
    const ns = buildNorthStar(
      series(
        ["2026-08-02", 80],
        ["2026-08-03", 80],
        ["2026-08-04", 80],
        ["2026-08-05", 4],
      ),
    );
    expect(ns.spark).toEqual([80, 80, 80]);
    // Average is over days strictly before yesterday.
    expect(ns.avg7d).toBe(80);
    expect(ns.deltaPct).toBe(0);
    expect(ns.last7d).toBe(240);
  });

  it("excludes yesterday from its own baseline so a spike doesn't self-cancel", () => {
    const ns = buildNorthStar(
      series(
        ["2026-08-01", 50],
        ["2026-08-02", 50],
        ["2026-08-03", 50],
        ["2026-08-04", 100],
      ),
    );
    expect(ns.avg7d).toBe(50);
    expect(ns.deltaPct).toBe(100);
  });

  it("flags stale when no events landed for yesterday at all", () => {
    const ns = buildNorthStar(series(["2026-08-01", 70], ["2026-08-02", 72]));
    expect(ns.trialStartsYesterday).toBe(null);
    expect(ns.stale).toBe(true);
  });

  it("reports zero, not null, for a today with no events yet", () => {
    const ns = buildNorthStar(series(["2026-08-04", 81]));
    expect(ns.trialStartsToday).toBe(0);
    expect(ns.stale).toBe(false);
  });

  it("degrades to empty when the source is unavailable", () => {
    const ns = buildNorthStar(null);
    expect(ns).toMatchObject({
      trialStartsYesterday: null,
      last7d: null,
      spark: [],
      stale: true,
    });
  });

  /**
   * Trial start rate = today's trials over today's Mixpanel onboarding starts.
   * Both sides must be the same Eastern day; the ratio is only meaningful
   * because the Mixpanel project timezone matches the view's bucketing.
   */
  describe("trial start rate", () => {
    it("divides today's trials by today's onboarding starts", () => {
      const ns = buildNorthStar(
        series(["2026-08-04", 81], ["2026-08-05", 40]),
        NOW,
        320,
      );
      expect(ns.onboardingStartsToday).toBe(320);
      expect(ns.trialStartRatePct).toBe(12.5);
    });

    it("rounds to one decimal", () => {
      const ns = buildNorthStar(series(["2026-08-05", 41]), NOW, 313);
      expect(ns.trialStartRatePct).toBe(13.1); // 13.099... → 13.1
    });

    it("omits the rate when Mixpanel is unavailable", () => {
      const ns = buildNorthStar(series(["2026-08-05", 40]), NOW, null);
      expect(ns.onboardingStartsToday).toBe(null);
      expect(ns.trialStartRatePct).toBe(null);
      expect(ns.trialStartsToday).toBe(40); // the chip still shows trials
    });

    /**
     * Just after Eastern midnight both numbers are 0. Rendering 0/0 as a
     * percentage would show "0% of 0 starts" — a dead funnel that isn't one.
     */
    it("omits the rate rather than dividing by zero", () => {
      const ns = buildNorthStar(series(["2026-08-04", 81]), NOW, 0);
      expect(ns.trialStartsToday).toBe(0);
      expect(ns.onboardingStartsToday).toBe(0);
      expect(ns.trialStartRatePct).toBe(null);
    });

    it("carries the onboarding count even when trial data is missing", () => {
      const ns = buildNorthStar(null, NOW, 320);
      expect(ns.onboardingStartsToday).toBe(320);
      expect(ns.trialStartRatePct).toBe(null);
    });
  });
});
