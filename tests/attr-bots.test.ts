import { describe, expect, it } from "vitest";
import { classifyBot, isBot, isMetaIp, META_IPV4_CIDRS } from "@/lib/attr-bots";

/**
 * Pins the /l bot filter to the traffic actually observed in the first 48h
 * of the EAC web campaign (2026-09-30 → 10-02): Meta's crawler, Meta's
 * ad-review fetchers hitting the rendered link from Meta IPs behind
 * ordinary-looking UAs, scrapers, and the two kinds of real tap.
 */

const IG_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23G90 Instagram 448.0.0.39.66 (iPhone17,1; iOS 26_6_2; en_US; en; scale=3.00; 1206x2622; 123456789)";
const FB_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23G83 Safari/604.1 [FBAN/FBIOS;FBAV/580.0.0.47.72;FBBV/123;FBDV/iPhone17,1;FBMD/iPhone;FBSN/iOS;FBSV/26.6.1;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]";
const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1";
const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

describe("isMetaIp", () => {
  it("recognises the ranges Meta's checkers actually used", () => {
    expect(isMetaIp("57.141.3.17")).toBe(true); // ad-review fetchers (spoofed UAs)
    expect(isMetaIp("69.171.251.9")).toBe(true); // facebookexternalhit
    expect(isMetaIp("173.252.83.20")).toBe(true);
    expect(isMetaIp("69.63.190.1")).toBe(true);
    expect(isMetaIp("2a03:2880:f12f:83:face:b00c:0:25de")).toBe(true);
  });

  it("leaves carriers, AWS and garbage alone", () => {
    expect(isMetaIp("98.122.10.4")).toBe(false); // a real Instagram tap
    expect(isMetaIp("172.58.40.2")).toBe(false); // T-Mobile
    expect(isMetaIp("44.249.10.1")).toBe(false); // AWS us-west-2 scanners
    expect(isMetaIp("57.142.0.1")).toBe(false); // one past 57.141.x
    expect(isMetaIp(null)).toBe(false);
    expect(isMetaIp("")).toBe(false);
    expect(isMetaIp("not-an-ip")).toBe(false);
    expect(isMetaIp("999.1.1.1")).toBe(false);
  });

  it("every configured CIDR parses to something that matches its own base", () => {
    for (const cidr of META_IPV4_CIDRS) {
      expect(isMetaIp(cidr.split("/")[0])).toBe(true);
    }
  });
});

describe("classifyBot", () => {
  it("passes real in-app taps from Instagram and Facebook", () => {
    expect(classifyBot(IG_UA, "98.122.10.4")).toBeNull();
    expect(classifyBot(FB_UA, "174.199.1.2")).toBeNull();
    expect(classifyBot(SAFARI_UA, "73.126.5.5")).toBeNull();
  });

  it("names Meta's crawler even from a non-Meta address", () => {
    expect(
      classifyBot("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "10.0.0.1"),
    ).toBe("meta_crawler");
    expect(
      classifyBot("meta-externalads/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)", null),
    ).toBe("meta_crawler");
  });

  it("catches Meta's ad-review fetchers by IP when the UA looks human", () => {
    expect(classifyBot(SAFARI_UA, "57.141.3.17")).toBe("meta_ip");
    expect(classifyBot(CHROME_WIN, "57.141.9.200")).toBe("meta_ip");
    expect(classifyBot(IG_UA, "57.141.2.2")).toBe("meta_ip"); // an IG-UA fetch from Meta's network
  });

  it("catches self-announcing bots and HTTP libraries", () => {
    expect(classifyBot("Python/3.11 aiohttp/3.11.15", "3.3.3.3")).toBe("bot_ua");
    expect(classifyBot("python-requests/2.28.1", "3.3.3.3")).toBe("bot_ua");
    expect(classifyBot("Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)", "3.3.3.3")).toBe("bot_ua");
    expect(
      classifyBot(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
        "17.1.1.1",
      ),
    ).toBe("bot_ua");
    expect(classifyBot("curl/8.0", "3.3.3.3")).toBe("bot_ua");
    expect(classifyBot(null, "3.3.3.3")).toBe("bot_ua"); // no UA at all is never a phone tap
  });

  it("does not over-match words inside real UAs", () => {
    // "Mobile", "Safari", "Instagram" etc. must not trip the generic bot regex
    expect(isBot(IG_UA, "1.2.3.4")).toBe(false);
    expect(isBot(FB_UA, "1.2.3.4")).toBe(false);
    expect(
      isBot(
        "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
        "1.2.3.4",
      ),
    ).toBe(false);
  });
});
