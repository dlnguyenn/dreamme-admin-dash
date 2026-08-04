import { describe, expect, it } from "vitest";
import {
  dateWindow,
  gainedSeries,
  pickDailyMode,
  publishedSeries,
  sumSeries,
  type DailyViewsRow,
  type PublishDateRow,
} from "@/lib/socialViews";

describe("dateWindow", () => {
  it("returns `days` inclusive UTC dates, oldest first", () => {
    const w = dateWindow(3, new Date("2026-08-04T12:00:00Z"));
    expect(w).toEqual(["2026-08-02", "2026-08-03", "2026-08-04"]);
  });
});

describe("gainedSeries", () => {
  const rows: DailyViewsRow[] = [
    { date: "2026-08-01", source: "doublespeed", cumulative_views: 1000, posts: 5 },
    { date: "2026-08-02", source: "doublespeed", cumulative_views: 1600, posts: 6 },
    { date: "2026-08-03", source: "doublespeed", cumulative_views: 1900, posts: 6 },
  ];

  it("diffs consecutive snapshots", () => {
    const s = gainedSeries(rows, ["2026-08-02", "2026-08-03"]);
    expect(s.map((p) => p.total)).toEqual([600, 300]);
    expect(s[0].bySource.doublespeed).toBe(600);
  });

  it("drops the first snapshot date rather than reporting the whole lifetime total as one day's gain", () => {
    const s = gainedSeries(rows, ["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(s[0]).toMatchObject({ date: "2026-08-01", total: 0 });
  });

  it("clamps a falling cumulative (a deleted post) to zero, never negative", () => {
    const falling: DailyViewsRow[] = [
      { date: "2026-08-01", source: "doublespeed", cumulative_views: 5000, posts: 9 },
      { date: "2026-08-02", source: "doublespeed", cumulative_views: 4000, posts: 8 },
    ];
    const s = gainedSeries(falling, ["2026-08-02"]);
    expect(s[0].total).toBe(0);
  });

  it("splits by source and fills window days with no data", () => {
    const two: DailyViewsRow[] = [
      ...rows.slice(0, 2),
      { date: "2026-08-01", source: "sideshift", cumulative_views: 100, posts: 1 },
      { date: "2026-08-02", source: "sideshift", cumulative_views: 250, posts: 2 },
    ];
    const s = gainedSeries(two, ["2026-08-02", "2026-08-03"]);
    expect(s[0].bySource).toMatchObject({ doublespeed: 600, sideshift: 150 });
    expect(s[0].total).toBe(750);
    // 08-03 is in the window but absent from the data.
    expect(s[1]).toMatchObject({ date: "2026-08-03", total: 0 });
  });
});

describe("publishedSeries", () => {
  it("buckets lifetime views by publish date and sums across sources", () => {
    const rows: PublishDateRow[] = [
      { date: "2026-08-02", source: "doublespeed", views: 900, posts: 9 },
      { date: "2026-08-02", source: "sideshift", views: 100, posts: 2 },
      { date: "2026-08-03", source: "doublespeed", views: 400, posts: 9 },
    ];
    const s = publishedSeries(rows, ["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(s.map((p) => p.total)).toEqual([0, 1000, 400]);
    expect(s[1].bySource).toMatchObject({ doublespeed: 900, sideshift: 100 });
    expect(sumSeries(s)).toBe(1400);
  });
});

describe("pickDailyMode", () => {
  const now = new Date("2026-08-04T12:00:00Z");

  it("uses the publish-date proxy when nothing has been snapshotted", () => {
    expect(pickDailyMode(null, 30, now).mode).toBe("published");
  });

  it("keeps the proxy while the real series only partly covers the window", () => {
    const got = pickDailyMode("2026-07-28", 30, now);
    expect(got.mode).toBe("published");
    // The reason must state the gap — a half-filled real series looks like a
    // collapse in reach, so the label is the thing stopping a wrong read.
    expect(got.reason).toContain("2026-07-28");
  });

  it("switches to real gained views once the history covers the window", () => {
    expect(pickDailyMode("2026-06-01", 30, now).mode).toBe("gained");
  });
});
