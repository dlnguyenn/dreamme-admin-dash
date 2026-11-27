import { describe, expect, it } from "vitest";
import { BeaconBody, beaconPatch, withUaFingerprint } from "@/lib/attr-installs";
import type { ClickCandidate } from "@/lib/attr-match";

const IG_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23G83 Instagram 448.0.0.39.66 (iPhone17,4; iOS 26_6_1; en_US; en; scale=3.00; 1125x2436; IABMV/1; 1072661960) Safari/604.1";

describe("BeaconBody / beaconPatch", () => {
  const id = "0f6b2c4e-9d2a-4c1b-8f3e-2a7c9d1e5b6a";

  it("accepts what the /l page sends and turns it into the click patch", () => {
    const body = BeaconBody.parse({ c: id, w: 375, h: 812, dpr: 3, lang: "en-US", tz: "America/New_York", wk: "605.1.15" });
    expect(beaconPatch(body, "2026-10-14T12:00:00.000Z")).toEqual({
      beacon_at: "2026-10-14T12:00:00.000Z",
      screen_w: 375,
      screen_h: 812,
      screen_scale: 3,
      lang: "en-US",
      timezone: "America/New_York",
      webkit: "605.1.15",
    });
  });

  it("rejects a non-UUID key, out-of-range numbers and oversized strings", () => {
    expect(BeaconBody.safeParse({ c: "nope", w: 375 }).success).toBe(false);
    expect(BeaconBody.safeParse({ c: id, w: 0 }).success).toBe(false);
    expect(BeaconBody.safeParse({ c: id, dpr: 50 }).success).toBe(false);
    expect(BeaconBody.safeParse({ c: id, tz: "x".repeat(65) }).success).toBe(false);
    expect(BeaconBody.safeParse({ c: id }).success).toBe(true);
  });

  it("never writes model or OS (a beacon cannot know them) and skips half a screen", () => {
    const patch = beaconPatch(BeaconBody.parse({ c: id, w: 375 }), "t");
    expect(patch).toEqual({ beacon_at: "t" });
  });
});

describe("withUaFingerprint", () => {
  const base: ClickCandidate & { ua: string | null } = {
    click_id: "c",
    clicked_at: "2026-10-14T12:00:00Z",
    ip: "203.0.113.7",
    platform_hint: "ios",
    fbclid: null,
    ua: IG_UA,
  };

  it("parses the UA for rows written before the fingerprint columns existed", () => {
    const c = withUaFingerprint(base);
    expect(c.model).toBe("iPhone17,4");
    expect(c.screen_w).toBe(375);
  });

  it("keeps stored (beaconed) values over UA-derived ones", () => {
    const c = withUaFingerprint({ ...base, screen_w: 390, screen_h: 844, lang: "en-GB" });
    expect(c.screen_w).toBe(390);
    expect(c.lang).toBe("en-GB");
    expect(c.model).toBe("iPhone17,4");
  });
});
