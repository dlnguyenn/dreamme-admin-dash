import { afterEach, describe, expect, it } from "vitest";
import { COMMENT_SCOPES, defaultScopes } from "@/lib/meta-oauth";
import {
  CLASSIFIER_SYSTEM,
  ANNOUNCEMENT,
  LIVE_MAX_HOURS,
  REPLY_VARIANTS,
  UPDATE_VARIANTS,
  commenterKey,
  decide,
  isLive,
  isOld,
  isTrivial,
  parseClassifications,
  pickVariant,
  type AdComment,
} from "@/lib/price-comment-replies";

const comment = (over: Partial<AdComment> = {}): AdComment => ({
  platform: "fb",
  commentId: "111_222",
  adId: "ad1",
  adName: "T0930_meme_ord002-07",
  objectId: "page_post",
  authorKey: "user1",
  authorIsUs: false,
  alreadyRepliedByUs: false,
  text: "how much is it?",
  createdTime: "2026-10-01T00:00:00+0000",
  ...over,
});

describe("pickVariant", () => {
  it("is deterministic per comment and always a known variant", () => {
    expect(pickVariant("abc")).toBe(pickVariant("abc"));
    for (const id of ["1", "2", "17841_99", "x".repeat(40)]) expect(REPLY_VARIANTS).toContain(pickVariant(id));
  });
  it("spreads across variants", () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => pickVariant(`c${i}`)));
    expect(seen.size).toBe(REPLY_VARIANTS.length);
  });
  it("never uses em dashes (house rule)", () => {
    for (const v of [...REPLY_VARIANTS, ...UPDATE_VARIANTS, ANNOUNCEMENT]) expect(v).not.toContain("—");
  });
  it("never names a medication", () => {
    for (const v of [...REPLY_VARIANTS, ...UPDATE_VARIANTS, ANNOUNCEMENT]) {
      expect(v).not.toMatch(/ozempic|wegovy|zepbound|mounjaro|semaglutide|tirzepatide|glp/i);
    }
  });
});

describe("isTrivial", () => {
  it("flags empty, mention-only and emoji-only comments", () => {
    expect(isTrivial("")).toBe(true);
    expect(isTrivial("@jess.m @amy_r")).toBe(true);
    expect(isTrivial("😂😂🔥")).toBe(true);
  });
  it("keeps text and money emoji", () => {
    expect(isTrivial("price?")).toBe(false);
    expect(isTrivial("💸💸")).toBe(false);
    expect(isTrivial("$$$")).toBe(false);
  });
});

describe("parseClassifications", () => {
  it("keeps only requested ids, normalises intent and clamps confidence", () => {
    const m = parseClassifications(
      [
        { id: "a", intent: "price", confidence: 0.93 },
        { id: "b", intent: "PRICE", confidence: "2" },
        { id: "zzz", intent: "price", confidence: 1 },
        null,
        { intent: "price" },
      ],
      ["a", "b", "c"],
    );
    expect(m.get("a")).toEqual({ intent: "price", confidence: 0.93 });
    expect(m.get("b")).toEqual({ intent: "other", confidence: 1 });
    expect(m.has("c")).toBe(false);
    expect(m.has("zzz")).toBe(false);
  });
  it("keeps the newer intents", () => {
    const m = parseClassifications(
      [
        { id: "a", intent: "competitor", confidence: 0.9 },
        { id: "b", intent: "price_answer", confidence: 0.9 },
        { id: "c", intent: "delete_everything", confidence: 0.9 },
      ],
      ["a", "b", "c"],
    );
    expect(m.get("a")?.intent).toBe("competitor");
    expect(m.get("b")?.intent).toBe("price_answer");
    expect(m.get("c")?.intent).toBe("other");
  });
  it("returns empty for non-arrays", () => {
    expect(parseClassifications({ id: "a" }, ["a"]).size).toBe(0);
  });
});

describe("decide", () => {
  const price = { intent: "price" as const, confidence: 0.9 };
  const fresh = Date.parse("2026-10-01T06:00:00Z"); // 6h after comment()
  const weeksLater = Date.parse("2026-10-20T00:00:00Z");
  it("replies to a confident price comment with a variant", () => {
    const d = decide(comment(), price, new Set(), fresh);
    expect(d?.status).toBe("replied");
    expect(REPLY_VARIANTS).toContain(d?.reply);
  });
  it("uses the update wording for old comments", () => {
    expect(isOld(comment(), fresh)).toBe(false);
    expect(isOld(comment(), weeksLater)).toBe(true);
    const d = decide(comment(), price, new Set(), weeksLater);
    expect(d?.status).toBe("replied");
    expect(UPDATE_VARIANTS).toContain(d?.reply);
  });
  it("hides confident competitor mentions and never replies to them", () => {
    const d = decide(comment(), { intent: "competitor", confidence: 0.9 }, new Set(), fresh);
    expect(d).toEqual({ status: "hidden" });
    expect(decide(comment({ alreadyRepliedByUs: true }), { intent: "competitor", confidence: 0.9 }, new Set())?.status).toBe("hidden");
    expect(decide(comment(), { intent: "competitor", confidence: 0.5 }, new Set())?.status).toBe("not_price");
    expect(decide(comment({ authorIsUs: true }), { intent: "competitor", confidence: 0.99 }, new Set())?.status).toBe("own_comment");
  });
  it("does not reply to someone telling others the price", () => {
    expect(decide(comment(), { intent: "price_answer", confidence: 0.95 }, new Set())?.status).toBe("not_price");
  });
  it("never replies to our own comments or already-answered ones", () => {
    expect(decide(comment({ authorIsUs: true }), price, new Set())?.status).toBe("own_comment");
    expect(decide(comment({ alreadyRepliedByUs: true }), price, new Set())?.status).toBe("already_answered");
  });
  it("skips low-confidence and non-price", () => {
    expect(decide(comment(), { intent: "price", confidence: 0.6 }, new Set())?.status).toBe("not_price");
    expect(decide(comment(), { intent: "other", confidence: 0.99 }, new Set())?.status).toBe("not_price");
  });
  it("leaves unclassified comments open", () => {
    expect(decide(comment(), undefined, new Set())).toBeNull();
  });
  it("replies once per person per ad, including within one run", () => {
    const seen = new Set<string>();
    expect(decide(comment({ commentId: "c1" }), price, seen)?.status).toBe("replied");
    expect(decide(comment({ commentId: "c2" }), price, seen)?.status).toBe("dup_commenter");
    expect(decide(comment({ commentId: "c3", adId: "ad2" }), price, seen)?.status).toBe("replied");
    expect(seen.has(commenterKey("ad1", "user1"))).toBe(true);
  });
  it("still replies when Meta withholds the author", () => {
    const seen = new Set<string>();
    expect(decide(comment({ authorKey: null }), price, seen)?.status).toBe("replied");
    expect(seen.size).toBe(0);
  });
});

describe("defaultScopes", () => {
  const prev = process.env.META_OAUTH_SCOPES;
  afterEach(() => {
    if (prev === undefined) delete process.env.META_OAUTH_SCOPES;
    else process.env.META_OAUTH_SCOPES = prev;
  });
  it("requests the comment scopes by default", () => {
    delete process.env.META_OAUTH_SCOPES;
    const s = defaultScopes().split(",");
    for (const c of COMMENT_SCOPES) expect(s).toContain(c);
    expect(s).toContain("ads_management");
  });
  it("keeps the comment scopes when META_OAUTH_SCOPES overrides the base", () => {
    process.env.META_OAUTH_SCOPES = "ads_read, ads_management,business_management";
    const s = defaultScopes().split(",");
    for (const c of COMMENT_SCOPES) expect(s).toContain(c);
    expect(s).toContain("ads_management");
    expect(new Set(s).size).toBe(s.length);
  });
});

describe("CLASSIFIER_SYSTEM", () => {
  it("keeps medication cost out of the price intent", () => {
    expect(CLASSIFIER_SYSTEM).toMatch(/cost of medication/);
  });
  it("does not treat medication brands or general tools as competitors", () => {
    expect(CLASSIFIER_SYSTEM).toMatch(/NOT competitors/);
  });
});

describe("isLive", () => {
  it("posts only with the env switch on", () => {
    expect(isLive("true", null, 72)).toBe(true);
    expect(isLive(undefined, null, 72)).toBe(false);
    expect(isLive("TRUE", null, 72)).toBe(false);
  });
  it("?dry_run=1 wins over the env switch", () => {
    expect(isLive("true", "1", 72)).toBe(false);
  });
  it("a long lookback is review-only, even when live", () => {
    expect(isLive("true", null, LIVE_MAX_HOURS)).toBe(true);
    expect(isLive("true", null, LIVE_MAX_HOURS + 1)).toBe(false);
    expect(isLive("true", null, 2160)).toBe(false);
  });
  it("a backlog run may act on a long lookback, but only with the switch on", () => {
    expect(isLive("true", null, 2160, true)).toBe(true);
    expect(isLive("true", "1", 2160, true)).toBe(false);
    expect(isLive(undefined, null, 2160, true)).toBe(false);
  });
});
