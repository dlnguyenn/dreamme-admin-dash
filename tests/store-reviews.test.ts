import { describe, expect, it } from "vitest";
import { attentionFor, playRow, summarizeStore, type StoreReviewRow } from "@/lib/store-reviews";

const review = (over: Partial<StoreReviewRow> = {}): StoreReviewRow => ({
  id: "app_store:1",
  store: "app_store",
  review_id: "1",
  rating: 5,
  title: "Love it",
  body: "My fish keeps me on track.",
  reviewer: "a",
  territory: "USA",
  language: null,
  app_version: null,
  device: null,
  reviewed_at: "2026-10-18T14:00:00.000Z",
  reply_body: null,
  replied_at: null,
  reply_state: null,
  handled_at: null,
  ...over,
});

describe("attentionFor", () => {
  it("leaves happy reviews alone", () => {
    expect(attentionFor(review()).needsAttention).toBe(false);
  });

  it("flags billing complaints on low ratings as urgent", () => {
    const a = attentionFor(review({ rating: 1, title: "GIVE ME BACK MY MONEY", body: "I still got charged $70" }));
    expect(a).toMatchObject({ needsAttention: true, urgent: true });
    expect(a.reasons).toContain("billing");
  });

  it("does not treat price praise on 5 stars as billing", () => {
    expect(attentionFor(review({ rating: 5, body: "Worth the subscription, reasonable price" })).needsAttention).toBe(false);
  });

  it("flags a broken app at any rating, curly apostrophes included", () => {
    const a = attentionFor(review({ rating: 4, title: "Crashes on iMac", body: "Love it but it won’t load" }));
    expect(a).toMatchObject({ needsAttention: true, urgent: true, reasons: ["broken"] });
  });

  it("flags a plain low rating as not urgent", () => {
    expect(attentionFor(review({ rating: 2, title: "Not a fan", body: "Other apps are more accurate" }))).toEqual({
      needsAttention: true,
      urgent: false,
      reasons: ["low_rating"],
    });
  });

  it("clears on a store reply", () => {
    expect(
      attentionFor(review({ rating: 1, body: "scam", reply_body: "Sorry!", replied_at: "2026-10-19T00:00:00.000Z" })).needsAttention,
    ).toBe(false);
  });

  it("reopens a Play review edited after our reply", () => {
    const a = attentionFor(
      review({ rating: 2, body: "still bad", reviewed_at: "2026-10-20T00:00:00.000Z", reply_body: "Fixed!", replied_at: "2026-10-19T00:00:00.000Z" }),
    );
    expect(a.reasons).toEqual(["edited_after_reply", "low_rating"]);
  });

  it("ignores a happy edit after our reply", () => {
    const r = review({ rating: 5, reviewed_at: "2026-08-09T00:00:00.000Z", reply_body: "Thanks!", replied_at: "2026-07-29T00:00:00.000Z" });
    expect(attentionFor(r).needsAttention).toBe(false);
  });

  it("clears on Mark handled, and reopens when the review changes later", () => {
    const r = review({ rating: 1, body: "bad", handled_at: "2026-10-19T00:00:00.000Z" });
    expect(attentionFor(r).needsAttention).toBe(false);
    expect(attentionFor({ ...r, reviewed_at: "2026-10-20T00:00:00.000Z" }).needsAttention).toBe(true);
  });
});

describe("playRow", () => {
  it("splits Play's title\\tbody and reads the developer reply", () => {
    const row = playRow({
      reviewId: "gp:abc",
      authorName: "Sam",
      comments: [
        { userComment: { text: "Great\tLove the fish", lastModified: { seconds: "1760918400" }, starRating: 5, appVersionName: "1.5.4" } },
        { developerComment: { text: "Thanks!", lastModified: { seconds: "1761004800" } } },
      ],
    });
    expect(row).toMatchObject({ id: "google_play:gp:abc", title: "Great", body: "Love the fish", rating: 5, reply_body: "Thanks!", app_version: "1.5.4" });
    expect(row?.reviewed_at).toBe("2025-10-20T00:00:00.000Z");
  });
});

describe("summarizeStore", () => {
  it("averages all-time and last 30 days per store", () => {
    const now = Date.parse("2026-10-27T00:00:00Z");
    const rows = [
      review({ id: "a", rating: 5, reviewed_at: "2026-10-20T00:00:00Z" }),
      review({ id: "b", rating: 1, reviewed_at: "2026-10-21T00:00:00Z", body: "bad" }),
      review({ id: "c", rating: 3, reviewed_at: "2026-01-01T00:00:00Z", reply_body: "hi" }),
      review({ id: "d", store: "google_play", rating: 4 }),
    ];
    expect(summarizeStore("app_store", rows, now)).toMatchObject({ count: 3, avgRating: 3, avgRating30d: 3, count30d: 2, needsAttention: 1, unreplied: 2 });
  });
});
