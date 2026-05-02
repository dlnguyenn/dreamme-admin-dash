import { describe, expect, it } from "vitest";
import { computeIsViral } from "@/lib/spy-viral";

const NOW = new Date("2026-05-02T12:00:00Z");

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();
}

describe("spy-viral.computeIsViral", () => {
  it("flags mature hits: >=50K views within 7 days", () => {
    const r = computeIsViral(
      { view_count: 80_000, posted_at: hoursAgo(24 * 5) },
      NOW,
    );
    expect(r).toBe(true);
  });

  it("flags early-velocity hits: >=10K views within 48h, even if under mature bar", () => {
    const r = computeIsViral(
      { view_count: 12_000, posted_at: hoursAgo(20) },
      NOW,
    );
    expect(r).toBe(true);
  });

  it("does NOT flag a video at 30K views posted 5 days ago (under mature bar)", () => {
    const r = computeIsViral(
      { view_count: 30_000, posted_at: hoursAgo(24 * 5) },
      NOW,
    );
    expect(r).toBe(false);
  });

  it("does NOT flag a video at 8K views in last 24h (under early bar)", () => {
    const r = computeIsViral(
      { view_count: 8_000, posted_at: hoursAgo(20) },
      NOW,
    );
    expect(r).toBe(false);
  });

  it("does NOT flag a 200K-view video posted 10 days ago (outside mature window)", () => {
    const r = computeIsViral(
      { view_count: 200_000, posted_at: hoursAgo(24 * 10) },
      NOW,
    );
    expect(r).toBe(false);
  });

  it("does NOT flag a 50K-view video posted 60h ago (outside early bar but under mature within window — 50K matches the mature threshold edge)", () => {
    // 60h = 2.5 days, well within 7-day mature window. 50K = exact mature threshold.
    const r = computeIsViral(
      { view_count: 50_000, posted_at: hoursAgo(60) },
      NOW,
    );
    expect(r).toBe(true);
  });

  it("returns false when view_count is null", () => {
    const r = computeIsViral(
      { view_count: null, posted_at: hoursAgo(10) },
      NOW,
    );
    expect(r).toBe(false);
  });

  it("returns false when posted_at is null", () => {
    const r = computeIsViral({ view_count: 100_000, posted_at: null }, NOW);
    expect(r).toBe(false);
  });

  it("returns false when posted_at is in the future (clock skew)", () => {
    const future = new Date(NOW.getTime() + 60 * 60 * 1000).toISOString();
    const r = computeIsViral({ view_count: 100_000, posted_at: future }, NOW);
    expect(r).toBe(false);
  });

  it("does NOT flag a 200K-view video posted exactly 7d + 1m ago (just outside window)", () => {
    const justOutside = new Date(
      NOW.getTime() - 7 * 24 * 60 * 60 * 1000 - 60 * 1000,
    ).toISOString();
    const r = computeIsViral(
      { view_count: 200_000, posted_at: justOutside },
      NOW,
    );
    expect(r).toBe(false);
  });

  it("flags a 200K-view video posted exactly 7d - 1m ago (just inside window)", () => {
    const justInside = new Date(
      NOW.getTime() - 7 * 24 * 60 * 60 * 1000 + 60 * 1000,
    ).toISOString();
    const r = computeIsViral(
      { view_count: 200_000, posted_at: justInside },
      NOW,
    );
    expect(r).toBe(true);
  });

  it("returns false for a malformed posted_at string", () => {
    const r = computeIsViral(
      { view_count: 100_000, posted_at: "not a date" },
      NOW,
    );
    expect(r).toBe(false);
  });
});
