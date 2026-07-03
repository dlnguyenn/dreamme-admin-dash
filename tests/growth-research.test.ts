import { describe, expect, it } from "vitest";
import {
  mergeCandidates,
  buildShortlist,
  isStrongFind,
  parseJsonLoose,
  validateCoding,
  type ResearchCandidate,
} from "@/lib/growth-research";

function cand(overrides: Partial<ResearchCandidate>): ResearchCandidate {
  return {
    url: `https://www.tiktok.com/@a/video/${Math.floor(Math.random() * 1e12)}`,
    post_id: null,
    author: "someone",
    views: 100_000,
    likes: 1000,
    comments: 100,
    caption: "",
    cover_url: null,
    posted_at: null,
    found_via: "test query",
    ...overrides,
  };
}

describe("mergeCandidates", () => {
  it("dedupes by url, first sighting wins (found_via stays honest)", () => {
    const a = cand({ url: "https://t/1", found_via: "round 1 query" });
    const b = cand({ url: "https://t/1", found_via: "round 2 query", views: 999 });
    const c = cand({ url: "https://t/2" });
    const merged = mergeCandidates([a], [b, c]);
    expect(merged).toHaveLength(2);
    expect(merged.find((x) => x.url === "https://t/1")!.found_via).toBe("round 1 query");
  });

  it("preserves inspect results on existing candidates across merges", () => {
    const inspected = cand({ url: "https://t/1", outlier_score: 6.2, strong: true });
    const merged = mergeCandidates([inspected], [cand({ url: "https://t/1" })]);
    expect(merged[0].outlier_score).toBe(6.2);
    expect(merged[0].strong).toBe(true);
  });
});

describe("buildShortlist", () => {
  it("ranks by views and caps per author so one account can't eat the budget", () => {
    const cands = [
      cand({ url: "https://t/1", author: "big", views: 900_000 }),
      cand({ url: "https://t/2", author: "big", views: 800_000 }),
      cand({ url: "https://t/3", author: "big", views: 700_000 }),
      cand({ url: "https://t/4", author: "small", views: 60_000 }),
    ];
    const list = buildShortlist(cands, 3, 2);
    expect(list).toEqual(["https://t/1", "https://t/2", "https://t/4"]);
  });

  it("caps at max and handles empty authors without collapsing them together", () => {
    const cands = [
      cand({ url: "https://t/1", author: "", views: 500_000 }),
      cand({ url: "https://t/2", author: "", views: 400_000 }),
      cand({ url: "https://t/3", author: "", views: 300_000 }),
    ];
    // authorless candidates key on their own url → none excluded by the per-author cap
    expect(buildShortlist(cands, 14, 2)).toHaveLength(3);
    expect(buildShortlist(cands, 2, 2)).toHaveLength(2);
  });
});

describe("isStrongFind", () => {
  it("keeps app-proof videos (visibility ≥2) even without a baseline", () => {
    expect(isStrongFind({ coding: { app_visibility: 2 }, outlier_score: null })).toBe(true);
    expect(isStrongFind({ coding: { app_visibility: 3 } })).toBe(true);
  });
  it("keeps creator-baseline outliers (≥3×) even with weak app visibility", () => {
    expect(isStrongFind({ coding: { app_visibility: 1 }, outlier_score: 3.4 })).toBe(true);
  });
  it("drops weak candidates", () => {
    expect(isStrongFind({ coding: { app_visibility: 1 }, outlier_score: 1.2 })).toBe(false);
    expect(isStrongFind({ coding: null, outlier_score: null })).toBe(false);
    expect(isStrongFind({})).toBe(false);
  });
});

describe("parseJsonLoose", () => {
  it("parses clean JSON", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });
  it("strips code fences and surrounding prose", () => {
    const out = parseJsonLoose('Here you go:\n```json\n{"app_visibility": 3, "score": 5}\n```\nHope that helps!');
    expect(out.app_visibility).toBe(3);
  });
  it("throws when there is no object", () => {
    expect(() => parseJsonLoose("no json here")).toThrow();
  });
});

describe("validateCoding", () => {
  it("clamps visibility/score and falls back on unknown enums", () => {
    const c = validateCoding({
      app_visibility: 7,
      app_name: "Yuka",
      app_category: "food",
      hook_transcript: "these foods scored 100",
      structure: "hook → scan → reveal",
      works_without_app: false,
      format: "dance_challenge", // not in the enum
      hook_type: "stat",
      why_it_hit: "receipt-style proof",
      score: 99,
    });
    expect(c.app_visibility).toBe(3);
    expect(c.score).toBe(5);
    expect(c.format).toBe("other");
    expect(c.hook_type).toBe("stat");
    expect(c.works_without_app).toBe(false);
  });

  it("survives garbage input with conservative defaults", () => {
    const c = validateCoding({});
    expect(c.app_visibility).toBe(0);
    expect(c.score).toBe(1);
    expect(c.works_without_app).toBe(false);
  });
});
