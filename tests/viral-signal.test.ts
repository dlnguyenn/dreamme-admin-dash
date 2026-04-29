import { describe, expect, it } from "vitest";
import {
  computeViralSignal,
  decideMode,
  type ViralCandidatePost,
} from "@/lib/viral-signal";
import type { PersonaBaseline } from "@/lib/baseline";

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

function post(
  id: string,
  views: number,
  hours: number,
): ViralCandidatePost {
  return { id, view_count: views, posted_at: hoursAgo(hours) };
}

const baseline: PersonaBaseline = {
  persona: "andrea",
  rolling_median_views: 2_000,
  rolling_p25_views: 800,
  rolling_p75_views: 6_000,
  sample_size: 40,
  window_start: hoursAgo(30 * 24),
};

describe("computeViralSignal", () => {
  it("flags a post that crosses the absolute threshold within window", () => {
    const r = computeViralSignal([post("a", 12_000, 4)], baseline);
    expect(r.viralCount).toBe(1);
    expect(r.viralPosts[0].reason).toBe("both"); // 12k > 10k absolute AND 12k > 6k relative
  });

  it("flags a post that crosses only persona-relative", () => {
    // 7k > 3*2k=6k relative bar, but < 10k absolute
    const r = computeViralSignal([post("a", 7_000, 4)], baseline);
    expect(r.viralCount).toBe(1);
    expect(r.viralPosts[0].reason).toBe("relative");
  });

  it("flags a post that crosses only absolute (small persona)", () => {
    const tinyBaseline: PersonaBaseline = {
      ...baseline,
      rolling_median_views: 100,
      rolling_p25_views: 50,
      rolling_p75_views: 200,
    };
    // 11k > 10k absolute, also > 300 relative bar — but if we set rel bar
    // higher than 11k it would only hit absolute. Let's use a different
    // configuration to isolate: lift the relative multiplier high so 11k
    // can't clear it.
    const r = computeViralSignal([post("a", 11_000, 4)], tinyBaseline, {
      relativeMultiplier: 200,
    });
    expect(r.viralCount).toBe(1);
    expect(r.viralPosts[0].reason).toBe("absolute");
  });

  it("excludes a post outside the 48h window even if its view count is huge", () => {
    const r = computeViralSignal([post("a", 500_000, 72)], baseline);
    expect(r.viralCount).toBe(0);
  });

  it("excludes a post with no posted_at timestamp", () => {
    const r = computeViralSignal(
      [{ id: "a", view_count: 50_000, posted_at: null }],
      baseline,
    );
    expect(r.viralCount).toBe(0);
  });

  it("falls back to absolute-only when baseline is null (cold-start persona)", () => {
    const r = computeViralSignal([post("a", 10_500, 4)], null);
    expect(r.viralCount).toBe(1);
    expect(r.viralPosts[0].reason).toBe("absolute");
  });

  it("returns zero viral when no post crosses either bar", () => {
    const r = computeViralSignal(
      [post("a", 1_500, 12), post("b", 800, 30)],
      baseline,
    );
    expect(r.viralCount).toBe(0);
  });

  it("evaluated count reflects all candidates regardless of viral status", () => {
    const r = computeViralSignal(
      [post("a", 500, 1), post("b", 1_500, 1), post("c", 50_000, 1)],
      baseline,
    );
    expect(r.evaluated).toBe(3);
    expect(r.viralCount).toBe(1);
  });

  it("respects custom thresholds", () => {
    const r = computeViralSignal([post("a", 5_000, 4)], baseline, {
      absoluteThreshold: 1_000,
      relativeMultiplier: 100,
    });
    expect(r.viralCount).toBe(1);
    expect(r.viralPosts[0].reason).toBe("absolute");
  });
});

describe("decideMode", () => {
  it("returns 'explore' when at least one viral hit", () => {
    expect(
      decideMode({
        evaluated: 5,
        viralCount: 1,
        viralPosts: [],
        thresholds: {
          absoluteViews: 10_000,
          relativeMultiplier: 3,
          windowHours: 48,
          personaMedian: 2_000,
        },
      }),
    ).toBe("explore");
  });

  it("returns 'exploit' when zero viral hits", () => {
    expect(
      decideMode({
        evaluated: 5,
        viralCount: 0,
        viralPosts: [],
        thresholds: {
          absoluteViews: 10_000,
          relativeMultiplier: 3,
          windowHours: 48,
          personaMedian: 2_000,
        },
      }),
    ).toBe("exploit");
  });
});
