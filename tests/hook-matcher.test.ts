import { describe, expect, it } from "vitest";
import {
  buildIndex,
  tryMatch,
  tryMatchByEmbedding,
  type UnmatchedGenerated,
} from "@/lib/hook-matcher";
import { normalizeHook } from "@/lib/hook-categories";

function gh(
  id: string,
  persona: "andrea" | "emma" | "olivia",
  hookText: string,
  daysAgo: number,
  embedding: number[] | null = null,
): UnmatchedGenerated {
  return {
    id,
    persona,
    hook_text: hookText,
    hook_normalized: normalizeHook(hookText),
    created_at: new Date(
      Date.now() - daysAgo * 24 * 60 * 60 * 1000,
    ).toISOString(),
    embedding,
  };
}

describe("hook-matcher.tryMatch", () => {
  it("returns null when no candidate exists for that persona+normalized key", () => {
    const idx = buildIndex([gh("a1", "andrea", "8 GLP-1 lessons", 2)]);
    const result = tryMatch(idx, {
      postId: "p-1",
      postUrl: "https://tiktok.com/x",
      persona: "emma",
      hookNormalized: normalizeHook("8 GLP-1 lessons"),
      postedAt: new Date().toISOString(),
    });
    expect(result).toBeNull();
  });

  it("matches the oldest unclaimed candidate (FIFO)", () => {
    const idx = buildIndex([
      gh("a-old", "andrea", "8 GLP-1 lessons", 5),
      gh("a-new", "andrea", "8 GLP-1 lessons", 1),
    ]);
    const m = tryMatch(idx, {
      postId: "p-1",
      postUrl: "u",
      persona: "andrea",
      hookNormalized: normalizeHook("8 GLP-1 lessons"),
      postedAt: new Date().toISOString(),
    });
    expect(m?.id).toBe("a-old");
  });

  it("does not match the same generated hook twice in one run", () => {
    const idx = buildIndex([gh("a1", "andrea", "8 GLP-1 lessons", 2)]);
    const first = tryMatch(idx, {
      postId: "p-1",
      postUrl: "u",
      persona: "andrea",
      hookNormalized: normalizeHook("8 GLP-1 lessons"),
      postedAt: new Date().toISOString(),
    });
    const second = tryMatch(idx, {
      postId: "p-2",
      postUrl: "v",
      persona: "andrea",
      hookNormalized: normalizeHook("8 GLP-1 lessons"),
      postedAt: new Date().toISOString(),
    });
    expect(first?.id).toBe("a1");
    expect(second).toBeNull();
  });

  it("rejects candidates whose created_at is after the post's posted_at", () => {
    const idx = buildIndex([gh("a1", "andrea", "8 GLP-1 lessons", 1)]);
    const postedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const result = tryMatch(idx, {
      postId: "p-1",
      postUrl: "u",
      persona: "andrea",
      hookNormalized: normalizeHook("8 GLP-1 lessons"),
      postedAt,
    });
    expect(result).toBeNull();
  });

  it("matches when posted_at is missing (cannot enforce ordering)", () => {
    const idx = buildIndex([gh("a1", "andrea", "8 GLP-1 lessons", 2)]);
    const result = tryMatch(idx, {
      postId: "p-1",
      postUrl: "u",
      persona: "andrea",
      hookNormalized: normalizeHook("8 GLP-1 lessons"),
      postedAt: null,
    });
    expect(result?.id).toBe("a1");
  });

  it("returns null for an empty hookNormalized input", () => {
    const idx = buildIndex([gh("a1", "andrea", "8 GLP-1 lessons", 2)]);
    const result = tryMatch(idx, {
      postId: "p-1",
      postUrl: "u",
      persona: "andrea",
      hookNormalized: "",
      postedAt: new Date().toISOString(),
    });
    expect(result).toBeNull();
  });

  it("treats hooks with the same normalized form as a single key", () => {
    // normalizeHook strips punctuation, lowercases, collapses spaces
    const idx = buildIndex([
      gh("a1", "andrea", "8 GLP-1 lessons.", 5),
      gh("a2", "andrea", "8 glp 1 lessons", 3),
    ]);
    const result = tryMatch(idx, {
      postId: "p-1",
      postUrl: "u",
      persona: "andrea",
      hookNormalized: normalizeHook("8 GLP-1 lessons"),
      postedAt: new Date().toISOString(),
    });
    expect(result?.id).toBe("a1");
  });
});

describe("hook-matcher.tryMatchByEmbedding (tier 2)", () => {
  // Synthetic embeddings: identical, near, and far. cosine([1,0,0],[1,0,0]) = 1
  const v_target = [1, 0, 0];
  const v_near = [0.95, 0.05, 0]; // similarity ~0.998
  const v_far = [0, 1, 0]; // similarity 0

  it("matches when nearest persona-scoped hook clears the threshold", () => {
    const idx = buildIndex([gh("a1", "andrea", "completely different text", 5, v_target)]);
    const r = tryMatchByEmbedding(
      idx,
      {
        persona: "andrea",
        postEmbedding: v_near,
        postedAt: new Date().toISOString(),
      },
      0.92,
    );
    expect(r?.match.id).toBe("a1");
    expect(r?.similarity).toBeGreaterThan(0.92);
  });

  it("returns null when nothing clears the threshold", () => {
    const idx = buildIndex([gh("a1", "andrea", "different", 5, v_far)]);
    const r = tryMatchByEmbedding(
      idx,
      {
        persona: "andrea",
        postEmbedding: v_target,
        postedAt: new Date().toISOString(),
      },
      0.92,
    );
    expect(r).toBeNull();
  });

  it("ignores cross-persona candidates", () => {
    const idx = buildIndex([gh("e1", "emma", "matchable", 2, v_target)]);
    const r = tryMatchByEmbedding(idx, {
      persona: "andrea",
      postEmbedding: v_near,
      postedAt: new Date().toISOString(),
    });
    expect(r).toBeNull();
  });

  it("ignores candidates older than the 14-day window", () => {
    const idx = buildIndex([gh("a-old", "andrea", "old", 30, v_target)]);
    const r = tryMatchByEmbedding(idx, {
      persona: "andrea",
      postEmbedding: v_near,
      postedAt: new Date().toISOString(),
    });
    expect(r).toBeNull();
  });

  it("ignores candidates created after the post (causality)", () => {
    const idx = buildIndex([gh("a1", "andrea", "future", 0, v_target)]);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const r = tryMatchByEmbedding(idx, {
      persona: "andrea",
      postEmbedding: v_near,
      postedAt: yesterday,
    });
    // hook created today, post posted yesterday — should reject
    expect(r).toBeNull();
  });

  it("does not match the same candidate twice in one run", () => {
    const idx = buildIndex([gh("a1", "andrea", "x", 2, v_target)]);
    const first = tryMatchByEmbedding(idx, {
      persona: "andrea",
      postEmbedding: v_near,
      postedAt: new Date().toISOString(),
    });
    const second = tryMatchByEmbedding(idx, {
      persona: "andrea",
      postEmbedding: v_near,
      postedAt: new Date().toISOString(),
    });
    expect(first?.match.id).toBe("a1");
    expect(second).toBeNull();
  });

  it("skips candidates with no embedding", () => {
    const idx = buildIndex([gh("a1", "andrea", "no embed", 2, null)]);
    const r = tryMatchByEmbedding(idx, {
      persona: "andrea",
      postEmbedding: v_target,
      postedAt: new Date().toISOString(),
    });
    expect(r).toBeNull();
  });
});
