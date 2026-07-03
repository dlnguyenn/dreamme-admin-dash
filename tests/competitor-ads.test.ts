import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeAd } from "@/lib/competitor-ads";

// Fixture cut from a REAL ScrapeCreators pull (data/competitor_ads.json,
// MeAgain App): one VIDEO ad, one collapsed variant (display_format null,
// no media at all), plus one synthetic IMAGE ad built on the real base to
// cover the images[] path the sample lacked.
const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "competitor-ads-sample.json"), "utf8"),
) as unknown[];

describe("normalizeAd", () => {
  it("normalizes a real VIDEO ad (preview frame as cover, unix dates → ISO)", () => {
    const ad = normalizeAd(fixture[0], "539227915950887");
    expect(ad).not.toBeNull();
    expect(ad!.mediaType).toBe("video");
    expect(ad!.coverUrl).toBeTruthy(); // video_preview_image_url
    expect(ad!.mediaUrl).toBeTruthy(); // video_sd_url
    expect(ad!.adArchiveId).toMatch(/^\d+$/);
    // NOTE: the ad's own page_id can DIFFER from the queried brand page
    // (real MeAgain data does) — the pipeline stores under the brand's id;
    // the normalizer just reports what the ad carries.
    expect(ad!.pageId).toMatch(/^\d+$/);
    expect(ad!.body.length).toBeGreaterThan(0); // snapshot.body.text
    // unix seconds → ISO
    if (ad!.startedAtISO) {
      expect(ad!.startedAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(new Date(ad!.startedAtISO).getFullYear()).toBeGreaterThan(2020);
    }
    expect(ad!.adLibraryUrl).toContain("facebook.com/ads/library");
    expect(Array.isArray(ad!.platforms)).toBe(true);
    expect(ad!.platforms.length).toBeGreaterThan(0); // publisher_platform key
  });

  it("normalizes a collapsed variant (display_format null, no media) as copy-only", () => {
    const ad = normalizeAd(fixture[1], "539227915950887");
    expect(ad).not.toBeNull();
    expect(ad!.mediaType).toBe("unknown");
    expect(ad!.coverUrl).toBeNull(); // → copy-only analysis path
    expect(ad!.body.length).toBeGreaterThan(0); // body still present
  });

  it("normalizes an IMAGE ad (images[0].resized_image_url as cover)", () => {
    const ad = normalizeAd(fixture[2], "539227915950887");
    expect(ad).not.toBeNull();
    expect(ad!.mediaType).toBe("image");
    expect(ad!.coverUrl).toBe("https://example.com/img.jpg");
  });

  it("returns null for garbage instead of throwing", () => {
    expect(normalizeAd({ nope: true }, "x")).toBeNull();
    expect(normalizeAd(null, "x")).toBeNull();
    expect(normalizeAd("string", "x")).toBeNull();
  });

  it("falls back to a constructed Ad Library URL when none provided", () => {
    const ad = normalizeAd({ ad_archive_id: "123", snapshot: {} }, "p1");
    expect(ad).not.toBeNull();
    expect(ad!.adLibraryUrl).toBe("https://www.facebook.com/ads/library/?id=123");
    expect(ad!.pageId).toBe("p1"); // fallback page id
    expect(ad!.isActive).toBe(true); // default when absent
  });
});
