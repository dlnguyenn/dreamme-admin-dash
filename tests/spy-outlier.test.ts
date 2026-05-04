import { describe, expect, it } from "vitest";
import {
  computeBaselineMedian,
  computeOutlierScore,
  computeViewsPerHour,
  isViralOutlier,
  MIN_BASELINE_POSTS,
  OUTLIER_VIRAL_THRESHOLD,
} from "@/lib/spy-outlier";

const NOW = new Date("2026-05-02T12:00:00Z");
const hoursAgo = (h: number) =>
  new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();

describe("computeBaselineMedian", () => {
  it("returns null below the minimum sample size", () => {
    const tooFew = Array.from({ length: MIN_BASELINE_POSTS - 1 }, () => 1000);
    expect(computeBaselineMedian(tooFew)).toBe(null);
  });

  it("computes median for odd-length input", () => {
    expect(computeBaselineMedian([100, 500, 1000])).toBe(500);
  });

  it("computes median for even-length input as midpoint average", () => {
    expect(computeBaselineMedian([100, 200, 800, 1000])).toBe(500);
  });

  it("is unfazed by an unsorted input", () => {
    expect(computeBaselineMedian([1000, 100, 500])).toBe(500);
  });
});

describe("computeOutlierScore", () => {
  it("returns null when baseline is null", () => {
    expect(computeOutlierScore(50_000, null)).toBe(null);
  });

  it("returns null when baseline is 0 or negative (no divide-by-zero)", () => {
    expect(computeOutlierScore(50_000, 0)).toBe(null);
    expect(computeOutlierScore(50_000, -10)).toBe(null);
  });

  it("returns the multiplier when baseline is positive", () => {
    expect(computeOutlierScore(60_000, 5_000)).toBe(12);
  });
});

describe("computeViewsPerHour", () => {
  it("returns null on missing inputs", () => {
    expect(computeViewsPerHour(null, hoursAgo(10), NOW)).toBe(null);
    expect(computeViewsPerHour(1000, null, NOW)).toBe(null);
  });

  it("clamps tiny ages to 1h to avoid divide-by-zero spikes", () => {
    // posted 0.1 hours ago, 100 views — without clamping that's 1000/hr noise.
    const veryRecent = new Date(NOW.getTime() - 6 * 60 * 1000).toISOString();
    const v = computeViewsPerHour(100, veryRecent, NOW);
    expect(v).toBe(100); // clamped to /1
  });

  it("returns views/hour for normal ages", () => {
    expect(computeViewsPerHour(10_000, hoursAgo(10), NOW)).toBe(1000);
  });
});

describe("isViralOutlier", () => {
  it("uses outlier_score when available — flags at >= 5x", () => {
    expect(
      isViralOutlier({
        view_count: 60_000,
        posted_at: hoursAgo(48),
        outlier_score: OUTLIER_VIRAL_THRESHOLD,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("does not flag a 4.9x outlier even with high absolute views", () => {
    expect(
      isViralOutlier({
        view_count: 5_000_000,
        posted_at: hoursAgo(48),
        outlier_score: 4.9,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("falls back to absolute thresholds when outlier_score is null (backward compat)", () => {
    // 80K views posted 5d ago, no baseline → mature absolute threshold catches it.
    expect(
      isViralOutlier({
        view_count: 80_000,
        posted_at: hoursAgo(24 * 5),
        outlier_score: null,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("falls back to early absolute threshold when no baseline", () => {
    expect(
      isViralOutlier({
        view_count: 12_000,
        posted_at: hoursAgo(20),
        outlier_score: null,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("does not flag a 30K-view post 5 days old with no baseline (under both bars)", () => {
    expect(
      isViralOutlier({
        view_count: 30_000,
        posted_at: hoursAgo(24 * 5),
        outlier_score: null,
        now: NOW,
      }),
    ).toBe(false);
  });
});
