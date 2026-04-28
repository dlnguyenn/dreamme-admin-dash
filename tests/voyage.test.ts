import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  parsePgVector,
  toPgVector,
} from "@/lib/voyage";

describe("voyage.cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBe(-1);
  });

  it("returns 0 for length mismatch (defensive)", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
  });

  it("returns 0 when either vector is all zeros", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 0, 0])).toBe(0);
    expect(cosineSimilarity([1, 0, 0], [0, 0, 0])).toBe(0);
  });

  it("computes a known intermediate similarity", () => {
    const sim = cosineSimilarity([3, 4], [4, 3]);
    // dot = 24, |a||b| = 5*5 = 25
    expect(sim).toBeCloseTo(0.96);
  });
});

describe("voyage.toPgVector / parsePgVector", () => {
  it("round-trips a vector through pg literal format", () => {
    const v = [0.1, -0.5, 1.5, 0];
    const literal = toPgVector(v);
    expect(literal).toBe("[0.1,-0.5,1.5,0]");
    const parsed = parsePgVector(literal);
    expect(parsed).toEqual(v);
  });

  it("parsePgVector returns null for malformed inputs", () => {
    expect(parsePgVector(null)).toBeNull();
    expect(parsePgVector("")).toBeNull();
    expect(parsePgVector("not a vector")).toBeNull();
    expect(parsePgVector("1,2,3")).toBeNull();
  });

  it("parsePgVector returns empty array for empty literal", () => {
    expect(parsePgVector("[]")).toEqual([]);
  });
});
