import { describe, expect, it } from "vitest";
import { lookupUrl, parseLookup, utcDay } from "@/lib/rating-snapshots";

describe("lookupUrl", () => {
  it("asks for DreamMe in one territory and busts Apple's cache", () => {
    expect(lookupUrl("us", 123)).toBe("https://itunes.apple.com/lookup?id=6755569693&country=us&cb=123");
  });
});

describe("parseLookup", () => {
  it("reads the count, average and version", () => {
    expect(
      parseLookup({ resultCount: 1, results: [{ userRatingCount: 3514, averageUserRating: 4.70575, version: "1.5.6" }] }),
    ).toEqual({ rating_count: 3514, average_rating: 4.706, app_version: "1.5.6" });
  });
  it("is null when the app isn't listed", () => {
    expect(parseLookup({ resultCount: 0, results: [] })).toBeNull();
    expect(parseLookup(null)).toBeNull();
  });
  it("is null when the count is missing or bad", () => {
    expect(parseLookup({ results: [{ averageUserRating: 4.7 }] })).toBeNull();
    expect(parseLookup({ results: [{ userRatingCount: -1 }] })).toBeNull();
  });
  it("keeps the count when the average is missing", () => {
    expect(parseLookup({ results: [{ userRatingCount: 0 }] })).toEqual({
      rating_count: 0,
      average_rating: null,
      app_version: null,
    });
  });
});

describe("utcDay", () => {
  it("uses the UTC date", () => {
    expect(utcDay(new Date("2026-11-16T23:30:00-05:00"))).toBe("2026-11-17");
  });
});
