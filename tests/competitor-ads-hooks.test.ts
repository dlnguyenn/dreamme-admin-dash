import { describe, expect, it } from "vitest";
import { appMention, cleanHook, evidence, groupHooks, hookBrief, hookKey, hookPattern, mergeHooks, type HookArchiveRow } from "@/lib/competitor-ads-tab/hooks";
import { renderUrl, smallThumbUrl, thumbPath } from "@/lib/competitor-ads-tab/thumbs";
import type { AdView } from "@/lib/competitor-ads-tab/logic";

// Invented lines with the same mechanics as the real ones (no competitor data in the repo).

function liveAd(over: Partial<AdView> & { id: string }): AdView {
  return {
    adArchiveId: over.id,
    pageId: "p1",
    brand: "BrandA",
    identity: "BrandA App",
    isPartnership: false,
    startedAt: "2026-10-01",
    endedAt: null,
    runDays: 30,
    mediaType: "video",
    format: null,
    thumb: null,
    video: null,
    videoSeconds: 20,
    title: null,
    body: null,
    hook: null,
    angle: null,
    theme: null,
    cta: null,
    adLibraryUrl: `https://www.facebook.com/ads/library/?id=${over.id}`,
    landing: {} as unknown as AdView["landing"],
    euReach: null,
    rank: { now: null } as AdView["rank"],
    storedBucket: null,
    rankPeak: null,
    copies: 1,
    creativeKey: null,
    confidence: { met: 0, of: 0, signals: [] },
    buckets: [],
    ...over,
  };
}

function archived(over: Partial<HookArchiveRow> & { hook: string }): HookArchiveRow {
  return {
    id: `brandA:${over.hook.slice(0, 8)}`,
    position: 1,
    tier: "A",
    score: 90,
    brand: "branda",
    hook_type: null,
    visual: null,
    style: null,
    identity: null,
    max_days: 60,
    ads: 5,
    live: 0,
    video_s: 12,
    first_start: null,
    ad_archive_id: null,
    source_file: "hooks-2026-11-10.csv",
    ...over,
  };
}

describe("cleanHook", () => {
  it("keeps the first screen as lines and moves later text aside", () => {
    expect(cleanHook("Week 5 on Mounjaro. / I cried over cold soup. → The app showed me why")).toEqual({
      lines: ["Week 5 on Mounjaro.", "I cried over cold soup."],
      later: "The app showed me why",
    });
    expect(cleanHook("The one thing I missed + [captions] Most people miss it → every week").lines).toEqual(["The one thing I missed"]);
  });
  it("turns spelled-out emoji back into emoji and drops caption markers", () => {
    expect(cleanHook("stuck on fiber? [down arrow] (word-by-word speech captions)").lines).toEqual(["stuck on fiber? 👇"]);
    expect(cleanHook("a hook [unknown thing]").lines).toEqual(["a hook"]);
  });
  it("does not cut at a plus sign that belongs to the hook", () => {
    expect(cleanHook("just started my shots + NO idea / what to cook??").lines).toEqual(["just started my shots + NO idea", "what to cook??"]);
  });
});

describe("hookPattern", () => {
  const p = (s: string) => hookPattern([s]);
  it("sorts openings into the patterns", () => {
    expect(p("Week 5 on Mounjaro. I cried over cold soup.")).toBe("timeline");
    expect(p("Day 12 on my GLP-1 and the fridge is empty")).toBe("timeline");
    expect(p("Three weeks into my GLP-1 and lunch is solved")).toBe("timeline");
    expect(p("still SO bloated on my GLP-1")).toBe("symptom");
    expect(p("my cartoon pet cries when I skip water")).toBe("mascot");
    expect(p("do you know your weekly GLP-1 pattern?")).toBe("question");
    expect(p("my doctor gave me a GLP-1 and no guidance")).toBe("noplan");
    expect(p("I wasted 2 months of my GLP-1 because of one mistake")).toBe("confession");
    expect(p("The easiest way to track your GLP-1")).toBe("other");
  });
  it("does not read a price as a timeline", () => {
    expect(p("paying $500 a month and guessing")).toBe("noplan");
  });
});

describe("appMention", () => {
  it("tells a named app from one teased as this", () => {
    expect(appMention(["Shotsy keeps it in one place"])).toBe("named");
    expect(appMention(["why am I only finding this now"])).toBe("this");
    expect(appMention(["Week 5 on Mounjaro."])).toBeNull();
  });
});

describe("mergeHooks", () => {
  it("collapses live copies and joins the archive row with the same opening", () => {
    const frame = "https://x.supabase.co/storage/v1/object/public/bucket/competitor-ads/111/222.jpg";
    const live = [
      liveAd({ id: "222", hook: "Week 5 on Mounjaro. I cried over cold soup.", rank: { now: 4 } as AdView["rank"], copies: 3, runDays: 20, thumb: frame }),
      liveAd({ id: "333", hook: "Week 5 on Mounjaro.\nI cried over cold soup.", rank: { now: 9 } as AdView["rank"], copies: 3, runDays: 25 }),
    ];
    const archive = [archived({ hook: "Week 5 on Mounjaro. / I cried over cold soup. → Then the app", max_days: 61, ads: 12, visual: "woman at the stove" })];
    const items = mergeHooks(live, archive);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ liveRank: 4, liveAds: 2, days: 61, copies: 12, inArchive: true, frame, shot: "woman at the stove", later: "Then the app", pattern: "timeline" });
    expect(evidence(items[0])).toBe("#4 today · 61 days live · 12 copies");
  });
  it("keeps archive-only hooks and orders a group by rank, then run length", () => {
    const items = mergeHooks(
      [liveAd({ id: "1", hook: "Day 3 on my shots. Toast only.", rank: { now: 7 } as AdView["rank"] })],
      [archived({ hook: "Day 40 on my shots / and the scale moved", max_days: 120 }), archived({ hook: "Day 9 on my shots / soup again", max_days: 30 })],
    );
    const [g] = groupHooks(items);
    expect(g.pattern.id).toBe("timeline");
    expect(g.items.map((h) => h.days)).toEqual([30, 120, 30]);
    expect(g.items[0].liveRank).toBe(7);
  });
  it("keys the same words the same way across line breaks and case", () => {
    expect(hookKey("BrandA", ["WEEK 5 on", "Mounjaro"])).toBe(hookKey("BrandA", ["week 5 on Mounjaro"]));
  });
});

describe("hookBrief", () => {
  it("lists each hook with its proof and the rules for our version", () => {
    const [h] = mergeHooks([], [archived({ hook: "Day 9 on my shots / soup again", visual: "woman at the stove", style: "white box", ad_archive_id: "999" })]);
    const brief = hookBrief([h], "2026-11-23");
    expect(brief).toContain("# Hook brief: 1 competitor hook to adapt (2026-11-23)");
    expect(brief).toContain("- On screen: Day 9 on my shots / soup again");
    expect(brief).toContain("- Opening shot: woman at the stove");
    expect(brief).toContain("- Proof: Branda, 60 days live, 5 copies");
    expect(brief).toContain("- Names the app in the hook: no");
    expect(brief).toContain("https://www.facebook.com/ads/library/?id=999");
  });
});

describe("thumbs", () => {
  const frame = "https://x.supabase.co/storage/v1/object/public/bucket/competitor-ads/539/1234.jpg";
  it("maps a stored frame to its small copy", () => {
    expect(thumbPath(frame)).toEqual({ origin: "https://x.supabase.co", bucket: "bucket", path: "competitor-ads/thumbs/w480/539/1234.jpg" });
    expect(smallThumbUrl(frame)).toBe("https://x.supabase.co/storage/v1/object/public/bucket/competitor-ads/thumbs/w480/539/1234.jpg");
    expect(renderUrl(frame)).toBe("https://x.supabase.co/storage/v1/render/image/public/bucket/competitor-ads/539/1234.jpg?width=480&height=960&resize=contain&quality=72");
  });
  it("leaves other URLs alone", () => {
    expect(thumbPath("https://cdn.example.com/a.jpg")).toBeNull();
    expect(thumbPath("https://x.supabase.co/storage/v1/object/public/bucket/competitor-ads/thumbs/w480/539/1234.jpg")).toBeNull();
    expect(renderUrl("https://cdn.example.com/a.jpg")).toBe("https://cdn.example.com/a.jpg");
  });
});
