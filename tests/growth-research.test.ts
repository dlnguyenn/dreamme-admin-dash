import { describe, expect, it } from "vitest";
import {
  mergeCandidates,
  buildShortlist,
  isStrongFind,
  parseJsonLoose,
  validateCoding,
  fromCheapSearchItem,
  extractTerms,
  applyPriorCodings,
  type ResearchCandidate,
  type VideoCoding,
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

describe("fromCheapSearchItem", () => {
  // shape pinned against a real paul_44/tiktok-search item
  const real = {
    id: "7644050844320550166",
    url: "https://www.tiktok.com/@exposrapp/video/7644050844320550166",
    channel: { username: "exposrapp", name: "EXPOSR App" },
    title: "Scan 3M+ safer alternatives on the EXPOSR app",
    views: 4600000,
    likes: 211800,
    comments: 15200,
    shares: 183100,
    uploadedAt: 1779769319,
    thumbnail: "https://p16.tiktokcdn.com/cover.jpg",
  };

  it("normalizes a real cheap-search item (title→caption, channel→author, unix→ISO)", () => {
    const c = fromCheapSearchItem(real, "safer food alternatives")!;
    expect(c).not.toBeNull();
    expect(c.url).toBe(real.url);
    expect(c.post_id).toBe("7644050844320550166");
    expect(c.author).toBe("exposrapp");
    expect(c.views).toBe(4600000);
    expect(c.caption).toBe(real.title);
    expect(c.cover_url).toBe(real.thumbnail);
    expect(c.posted_at).toMatch(/^2026-/);
    expect(c.found_via).toBe("safer food alternatives");
  });

  it("returns null without a url and tolerates missing fields", () => {
    expect(fromCheapSearchItem({ title: "no url" }, "q")).toBeNull();
    const bare = fromCheapSearchItem({ url: "https://t/9" }, "q")!;
    expect(bare.author).toBe("");
    expect(bare.views).toBe(0);
    expect(bare.posted_at).toBeNull();
  });
});

describe("extractTerms", () => {
  it("keeps topic words, drops stopwords and short words", () => {
    const terms = extractTerms("Look for viral B2C app videos with a food scanner or in the health niche");
    expect(terms).toContain("scanner");
    expect(terms).toContain("health");
    expect(terms).toContain("food");
    expect(terms).not.toContain("look");
    expect(terms).not.toContain("viral");
    expect(terms).not.toContain("b2c");
  });
  it("dedupes and caps", () => {
    const terms = extractTerms("protein protein protein tracking tracking macro counting fiber weight journey glp-1 medication logging", 4);
    expect(terms.length).toBeLessThanOrEqual(4);
    expect(new Set(terms).size).toBe(terms.length);
  });
});

describe("applyPriorCodings", () => {
  const coding: VideoCoding = {
    app_visibility: 3, app_name: "EXPOSR", app_category: "wellness",
    hook_transcript: "bad news for pizza lovers", structure: "hook → scan → verdict",
    works_without_app: false, format: "other", hook_type: "stat",
    why_it_hit: "brand fear + scan payoff", score: 5,
  };

  it("copies coding + derives outlier from the prior baseline; never overwrites fresh coding", () => {
    const already = cand({ url: "https://t/1", coding, coded_from: "video" });
    const reusable = cand({ url: "https://t/2", views: 600_000 });
    const unknown = cand({ url: "https://t/3" });
    const map = new Map([
      ["https://t/2", { coding, baseline_median: 50_000 }],
      ["https://t/1", { coding: { ...coding, score: 1 }, baseline_median: 1 }],
    ]);
    const reused = applyPriorCodings([already, reusable, unknown], map);
    expect(reused).toBe(1);
    expect(reusable.coded_from).toBe("prior");
    expect(reusable.outlier_score).toBe(12); // 600k / 50k
    expect(already.coding!.score).toBe(5); // untouched
    expect(unknown.coding).toBeUndefined();
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
