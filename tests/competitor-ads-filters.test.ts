import { describe, expect, it } from "vitest";
import { DEFAULT_FILTER, collapseCopies, filterAds, movement, setCounts, sortAds, type AdFilter } from "@/lib/competitor-ads-tab/filters";
import type { AdView } from "@/lib/competitor-ads-tab/logic";

// Made-up ids and numbers; no real competitor data in this repo.
function view(over: Partial<AdView> & { id: string }): AdView {
  return {
    adArchiveId: over.id,
    pageId: "p1",
    brand: "Alpha",
    identity: "Alpha",
    isPartnership: false,
    startedAt: "2026-11-01T00:00:00Z",
    runDays: 20,
    mediaType: "video",
    format: null,
    thumb: null,
    video: null,
    videoSeconds: null,
    title: null,
    body: null,
    hook: null,
    angle: null,
    theme: null,
    cta: null,
    adLibraryUrl: "",
    landing: { kind: "none", appId: null, cpp: null },
    euReach: null,
    rank: { now: null, ago7: null, ago14: null, top20: 0, top50: 0, observed: 14, best: null },
    storedBucket: null,
    rankPeak: null,
    copies: 1,
    creativeKey: null,
    confidence: { met: 0, of: 0, signals: [] },
    buckets: [],
    ...over,
  } as AdView;
}

const ads: AdView[] = [
  view({ id: "a", rank: { now: 3, ago7: 10, ago14: null, top20: 9, top50: 14, observed: 14, best: 2 }, isPartnership: true, identity: "creator.one", hook: "Week 3 on my shot", copies: 4 }),
  view({ id: "b", rank: { now: 1, ago7: 1, ago14: 1, top20: 14, top50: 14, observed: 14, best: 1 }, buckets: ["evergreen"], runDays: 60, startedAt: "2026-09-20T00:00:00Z" }),
  view({ id: "c", runDays: 2, startedAt: "2026-11-20T00:00:00Z", mediaType: "image", brand: "Beta", landing: { kind: "app_store", appId: "1", cpp: "cpp-1" } as AdView["landing"] }),
  view({ id: "d", rank: { now: 30, ago7: 80, ago14: null, top20: 0, top50: 3, observed: 14, best: 30 }, buckets: ["riser"], brand: "Beta", copies: 4 }),
];

const f = (over: Partial<AdFilter>): AdFilter => ({ ...DEFAULT_FILTER, ...over });

describe("filterAds", () => {
  it("defaults to ranked ads", () => {
    expect(filterAds(ads, DEFAULT_FILTER).map((a) => a.id)).toEqual(["a", "b", "d"]);
  });
  it("splits breakouts, long-running and new", () => {
    expect(filterAds(ads, f({ set: "rising" })).map((a) => a.id)).toEqual(["d"]);
    expect(filterAds(ads, f({ set: "lasting" })).map((a) => a.id)).toEqual(["b"]);
    expect(filterAds(ads, f({ set: "new" })).map((a) => a.id)).toEqual(["c"]);
  });
  it("filters by brand, creator accounts, format, identity, page and text", () => {
    expect(filterAds(ads, f({ set: "all", brand: "Beta" })).map((a) => a.id)).toEqual(["c", "d"]);
    expect(filterAds(ads, f({ set: "all", runsAs: "creators" })).map((a) => a.id)).toEqual(["a"]);
    expect(filterAds(ads, f({ set: "all", runsAs: "brand" })).map((a) => a.id)).toEqual(["b", "c", "d"]);
    expect(filterAds(ads, f({ set: "all", format: "image" })).map((a) => a.id)).toEqual(["c"]);
    expect(filterAds(ads, f({ set: "all", identity: "creator.one" })).map((a) => a.id)).toEqual(["a"]);
    expect(filterAds(ads, f({ set: "all", cpp: "cpp-1" })).map((a) => a.id)).toEqual(["c"]);
    expect(filterAds(ads, f({ set: "all", query: "  WEEK 3 " })).map((a) => a.id)).toEqual(["a"]);
  });
});

describe("sortAds", () => {
  it("sorts by rank with unranked last", () => {
    expect(sortAds(ads, "rank").map((a) => a.id)).toEqual(["b", "a", "d", "c"]);
  });
  it("sorts by days live, newest and copies, ties by rank", () => {
    expect(sortAds(ads, "days").map((a) => a.id)).toEqual(["b", "a", "d", "c"]);
    expect(sortAds(ads, "newest").map((a) => a.id)[0]).toBe("c");
    expect(sortAds(ads, "copies").map((a) => a.id)).toEqual(["a", "d", "b", "c"]);
  });
  it("doesn't change the input", () => {
    const before = ads.map((a) => a.id);
    sortAds(ads, "newest");
    expect(ads.map((a) => a.id)).toEqual(before);
  });
});

describe("setCounts and movement", () => {
  it("counts each set within a brand", () => {
    expect(setCounts(ads, "all")).toEqual({ ranked: 3, rising: 1, lasting: 1, new: 1, all: 4 });
    expect(setCounts(ads, "Beta")).toEqual({ ranked: 1, rising: 1, lasting: 0, new: 1, all: 2 });
  });
  it("words the weekly move", () => {
    expect(movement(ads[0])).toEqual({ text: "up 7", dir: "up" });
    expect(movement(ads[1])).toEqual({ text: "same as a week ago", dir: "flat" });
    expect(movement({ rank: { now: 5, ago7: null, ago14: null, top20: 1, top50: 1, observed: 14, best: 5 }, runDays: 3 })).toEqual({ text: "new", dir: "new" });
    expect(movement({ rank: { now: 5, ago7: null, ago14: null, top20: 1, top50: 1, observed: 3, best: 5 }, runDays: 30 }).dir).toBe("none");
  });
});

describe("collapseCopies", () => {
  it("keeps the best-ranked copy of each creative per brand", () => {
    const r = (now: number | null) => ({ now, ago7: null, ago14: null, top20: 0, top50: 0, observed: 14, best: now });
    const list = [
      view({ id: "x2", creativeKey: "asset:1", rank: r(5) }),
      view({ id: "x1", creativeKey: "asset:1", rank: r(2) }),
      view({ id: "y", creativeKey: "asset:1", brand: "Beta", rank: r(9) }),
      view({ id: "n1", creativeKey: null }),
      view({ id: "n2", creativeKey: null }),
    ];
    expect(collapseCopies(list).map((a) => a.id)).toEqual(["x1", "y", "n1", "n2"]);
  });
});
