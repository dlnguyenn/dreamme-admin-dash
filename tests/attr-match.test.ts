import { describe, expect, it } from "vitest";
import {
  parseClickParams,
  platformFromUa,
  mintFbp,
  readFbpCookie,
  resolveFbp,
  FBP_MAX_AGE_S,
  storeUrlFor,
  pickMatch,
  collapseDuplicateTaps,
  DUPLICATE_TAP_WINDOW_MS,
  parseClickUa,
  normalizeOsVersion,
  compareFingerprint,
  strongAgreement,
  ipPrefixRange,
  type ClickCandidate,
  type InstallForMatch,
} from "@/lib/attr-match";

/**
 * Contract-first suite for attribution phase 2 (click capture + matcher),
 * written before the implementation. The matcher is deliberately pure —
 * (install, clicks[]) -> verdict — so every attribution decision the
 * pipeline will ever make is enumerable here.
 */

// ── click param parsing (the /l redirect) ──────────────────────────────

describe("parseClickParams", () => {
  const sp = (q: string) => new URLSearchParams(q);

  it("maps the placement + site source macros Appstack's link carries", () => {
    const p = parseClickParams(sp("pl=Instagram_Reels&ss=ig"));
    expect(p).toMatchObject({ placement: "Instagram_Reels", site_source_name: "ig" });
    expect(parseClickParams(sp("pl={{placement}}")).placement).toBeNull();
  });

  it("maps the canonical Meta-macro params", () => {
    const p = parseClickParams(
      sp("src=meta&c=120210001&cn=iOS%20Broad&as=120210002&asn=US%20All&a=120210003&an=Video%2015s&fbclid=IwARabc"),
    );
    expect(p).toMatchObject({
      media_source: "meta",
      campaign_id: "120210001",
      campaign_name: "iOS Broad",
      adset_id: "120210002",
      adset_name: "US All",
      ad_id: "120210003",
      ad_name: "Video 15s",
      fbclid: "IwARabc",
    });
  });

  it("nulls unrendered macros instead of storing template junk", () => {
    // A misconfigured ad ships the literal {{ad.id}} — that must never
    // pollute ad_id grouping.
    const p = parseClickParams(sp("c=%7B%7Bcampaign.id%7D%7D&a={{ad.id}}"));
    expect(p.campaign_id).toBeNull();
    expect(p.ad_id).toBeNull();
  });

  it("caps runaway values and tolerates absence", () => {
    const p = parseClickParams(sp(`an=${"x".repeat(500)}`));
    expect((p.ad_name as string).length).toBe(200);
    expect(p.campaign_id).toBeNull();
    expect(p.creator_code).toBeNull();
  });

  it("captures creator codes for rev-share links", () => {
    expect(parseClickParams(sp("creator=MIA")).creator_code).toBe("MIA");
  });
});

// ── UA platform + store routing ────────────────────────────────────────

describe("platformFromUa / storeUrlFor", () => {
  const IOS_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const ANDROID_UA =
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

  it("classifies the big three", () => {
    expect(platformFromUa(IOS_UA)).toBe("ios");
    expect(platformFromUa(ANDROID_UA)).toBe("android");
    expect(platformFromUa("curl/8.0")).toBe("other");
    expect(platformFromUa(null)).toBe("other");
  });

  it("routes ios->App Store, android->Play, unknown->App Store (US iOS-first app)", () => {
    expect(storeUrlFor("ios")).toContain("apps.apple.com");
    expect(storeUrlFor("ios")).toContain("6755569693");
    expect(storeUrlFor("android")).toContain("play.google.com");
    expect(storeUrlFor("android")).toContain("com.dreamme.app");
    expect(storeUrlFor("other")).toContain("apps.apple.com");
  });
});

// ── the matcher ────────────────────────────────────────────────────────

const T0 = Date.parse("2026-08-28T12:00:00Z");
const iso = (msAgoFromInstall: number) => new Date(T0 - msAgoFromInstall).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const install: InstallForMatch = {
  ip: "203.0.113.7",
  platform: "ios",
  first_open_at: new Date(T0).toISOString(),
};

function click(over: Partial<ClickCandidate>): ClickCandidate {
  return {
    click_id: over.click_id ?? "c-1",
    clicked_at: over.clicked_at ?? iso(10 * MIN),
    ip: "203.0.113.7",
    platform_hint: "ios",
    fbclid: null,
    ...over,
  };
}

describe("pickMatch", () => {
  it("matches a single fresh same-ip click at HIGH confidence", () => {
    const m = pickMatch(install, [click({ clicked_at: iso(20 * MIN) })]);
    expect(m?.click?.click_id).toBe("c-1");
    expect(m?.confidence).toBe("high");
    expect(m?.method).toBe("exact_ip");
  });

  it("degrades to MEDIUM past the 1h window, LOW past 24h", () => {
    expect(pickMatch(install, [click({ clicked_at: iso(3 * HOUR) })])?.confidence).toBe("medium");
    expect(pickMatch(install, [click({ clicked_at: iso(3 * DAY) })])?.confidence).toBe("low");
  });

  it("returns null when nothing is eligible", () => {
    expect(pickMatch(install, [])).toBeNull();
    expect(pickMatch(install, [click({ ip: "198.51.100.9" })])).toBeNull(); // ip mismatch
    expect(pickMatch(install, [click({ clicked_at: iso(9 * DAY) })])).toBeNull(); // too old
  });

  it("rejects platform-contradicting clicks but accepts unknown UAs", () => {
    expect(pickMatch(install, [click({ platform_hint: "android" })])).toBeNull();
    expect(pickMatch(install, [click({ platform_hint: "other" })])).not.toBeNull();
  });

  it("tolerates small clock skew but not clicks meaningfully after the install", () => {
    expect(pickMatch(install, [click({ clicked_at: iso(-2 * MIN) })])).not.toBeNull(); // 2min "future" = skew
    expect(pickMatch(install, [click({ clicked_at: iso(-30 * MIN) })])).toBeNull(); // click after install
  });

  it("is last-click: multiple candidates pick the latest, confidence downgraded a notch", () => {
    const m = pickMatch(install, [
      click({ click_id: "older", clicked_at: iso(50 * MIN) }),
      click({ click_id: "newer", clicked_at: iso(10 * MIN) }),
    ]);
    expect(m?.click?.click_id).toBe("newer");
    // both are within the hour, but ambiguity costs one notch: high -> medium
    expect(m?.confidence).toBe("medium");
  });

  it("never lets ambiguity fall below LOW", () => {
    const m = pickMatch(install, [
      click({ click_id: "a", clicked_at: iso(3 * DAY) }),
      click({ click_id: "b", clicked_at: iso(2 * DAY) }),
    ]);
    expect(m?.click?.click_id).toBe("b");
    expect(m?.confidence).toBe("low");
  });

  it("does not let a double-loaded tap downgrade confidence as ambiguity", () => {
    // Instagram's in-app browser loads the link twice within seconds —
    // same fbclid, same IP. One tap, HIGH, not "two candidates, MEDIUM".
    const m = pickMatch(install, [
      click({ click_id: "first", fbclid: "PAZ9", clicked_at: iso(10 * MIN) }),
      click({ click_id: "echo", fbclid: "PAZ9", clicked_at: iso(10 * MIN - 2000) }),
    ]);
    expect(m?.click?.click_id).toBe("first");
    expect(m?.confidence).toBe("high");
  });
});

// ── duplicate taps ─────────────────────────────────────────────────────

describe("collapseDuplicateTaps", () => {
  const row = (id: string, fbclid: string | null, at: string) => ({ click_id: id, fbclid, clicked_at: at });

  it("keeps the first of a same-fbclid double load and drops the echo", () => {
    const out = collapseDuplicateTaps([
      row("b", "PAZ1", "2026-10-01T18:07:55.900Z"),
      row("a", "PAZ1", "2026-10-01T18:07:55.100Z"),
      row("c", "PAZ2", "2026-10-01T18:08:00.000Z"),
    ]);
    expect(out.map((r) => r.click_id)).toEqual(["a", "c"]);
  });

  it("treats the same fbclid outside the window as a new tap", () => {
    const t0 = Date.parse("2026-10-01T10:00:00Z");
    const out = collapseDuplicateTaps([
      row("a", "PAZ1", new Date(t0).toISOString()),
      row("b", "PAZ1", new Date(t0 + DUPLICATE_TAP_WINDOW_MS + 1).toISOString()),
    ]);
    expect(out).toHaveLength(2);
  });

  it("never collapses rows without an fbclid", () => {
    const out = collapseDuplicateTaps([
      row("a", null, "2026-10-01T10:00:00Z"),
      row("b", null, "2026-10-01T10:00:01Z"),
    ]);
    expect(out).toHaveLength(2);
  });
});

// ── fbp (first-party browser id on /l) ─────────────────────────────────

describe("fbp", () => {
  const NOW_MS = 1_790_000_000_000;

  it("mints Meta's fb.<subdomainIndex>.<ms>.<random> format from the host", () => {
    expect(mintFbp("go.dreamme.life", NOW_MS, 1234567890)).toBe(`fb.2.${NOW_MS}.1234567890`);
    expect(mintFbp("dreamme.life", NOW_MS, 7)).toBe(`fb.1.${NOW_MS}.7`);
    expect(mintFbp("localhost:3000", NOW_MS, 7)).toBe(`fb.0.${NOW_MS}.7`);
  });

  it("reads a well-formed _fbp from the Cookie header and ignores junk", () => {
    expect(readFbpCookie(`a=1; _fbp=fb.2.${NOW_MS}.42; b=2`)).toBe(`fb.2.${NOW_MS}.42`);
    expect(readFbpCookie("_fbp=<script>")).toBeNull();
    expect(readFbpCookie("other=1")).toBeNull();
    expect(readFbpCookie(null)).toBeNull();
  });

  it("keeps the visitor's existing fbp, otherwise mints one; always re-sets the 90-day cookie", () => {
    const kept = resolveFbp(`_fbp=fb.2.1700000000000.99`, "go.dreamme.life", NOW_MS, 5);
    expect(kept.fbp).toBe("fb.2.1700000000000.99");
    const minted = resolveFbp(null, "go.dreamme.life", NOW_MS, 5);
    expect(minted.fbp).toBe(`fb.2.${NOW_MS}.5`);
    expect(minted.setCookie).toBe(`_fbp=fb.2.${NOW_MS}.5; Max-Age=${FBP_MAX_AGE_S}; Path=/; Secure; SameSite=Lax`);
  });
});

// ── device fingerprint (Appstack teardown, 2026-10-14) ─────────────────

const FB_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23G90 Safari/604.1 [FBAN/FBIOS;FBAV/581.0.0.64.71;FBBV/1080178719;FBDV/iPhone14,3;FBMD/iPhone;FBSN/iOS;FBSV/26.6.2;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]";
const IG_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23G83 Instagram 448.0.0.39.66 (iPhone17,4; iOS 26_6_1; en_US; en; scale=3.00; 1125x2436; IABMV/1; 1072661960) Safari/604.1";
const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

describe("parseClickUa", () => {
  it("reads model, iOS, scale and locale from the Facebook in-app browser", () => {
    expect(parseClickUa(FB_UA)).toEqual({ model: "iPhone14,3", os_version: "26.6.2", screen_scale: 3, lang: "en_US" });
  });

  it("reads the Instagram tuple and converts its pixel resolution to points", () => {
    expect(parseClickUa(IG_UA)).toEqual({
      model: "iPhone17,4",
      os_version: "26.6.1",
      lang: "en_US",
      screen_scale: 3,
      screen_w: 375,
      screen_h: 812,
    });
  });

  it("learns nothing from plain Safari (every iPhone says iPhone) or no UA", () => {
    expect(parseClickUa(SAFARI_UA)).toEqual({});
    expect(parseClickUa(null)).toEqual({});
  });

  it("normalises iOS version spellings", () => {
    expect(normalizeOsVersion("26_6_1")).toBe("26.6.1");
    expect(normalizeOsVersion("iOS 26.6")).toBe("26.6");
    expect(normalizeOsVersion(null)).toBeNull();
  });
});

describe("compareFingerprint", () => {
  const phone = {
    model: "iPhone17,4",
    os_version: "26.6.1",
    screen_scale: 3,
    screen_w: 375,
    screen_h: 812,
    timezone: "America/New_York",
    lang: "en-US",
  };

  it("counts only fields both sides have; agreement on every shared field", () => {
    const c = compareFingerprint(phone, parseClickUa(IG_UA));
    expect(c.conflict).toEqual([]);
    expect(c.agree).toEqual(["model", "os_version", "screen_scale", "screen", "lang"]);
  });

  it("flags a different phone on the same IP as a conflict", () => {
    const c = compareFingerprint(phone, parseClickUa(FB_UA)); // iPhone14,3 vs 17,4
    expect(c.conflict).toContain("model");
    expect(strongAgreement(c)).toBe(false);
  });

  it("treats an install on a newer iOS than the click as neutral, an older one as a conflict", () => {
    expect(compareFingerprint({ os_version: "26.7" }, { os_version: "26.6.1" }).conflict).toEqual([]);
    expect(compareFingerprint({ os_version: "26.7" }, { os_version: "26.6.1" }).agree).toEqual([]);
    expect(compareFingerprint({ os_version: "26.5" }, { os_version: "26.6.1" }).conflict).toEqual(["os_version"]);
    expect(compareFingerprint({ os_version: "18.7" }, { os_version: "26.6.1" }).conflict).toEqual(["os_version"]);
  });

  it("accepts the screen in either orientation and the language by primary subtag", () => {
    const c = compareFingerprint(phone, { screen_w: 812, screen_h: 375, lang: "en_GB", timezone: "america/new_york" });
    expect(c.agree).toEqual(["screen", "timezone", "lang"]);
    expect(compareFingerprint(phone, { lang: "es-MX" }).conflict).toEqual(["lang"]);
  });

  it("strong agreement needs the model plus one field, or screen+scale plus one (Safari + beacon)", () => {
    expect(strongAgreement({ agree: ["model", "screen_scale"], conflict: [] })).toBe(true);
    expect(strongAgreement({ agree: ["model"], conflict: [] })).toBe(false);
    expect(strongAgreement({ agree: ["screen", "screen_scale", "timezone"], conflict: [] })).toBe(true);
    expect(strongAgreement({ agree: ["screen", "screen_scale"], conflict: [] })).toBe(false);
    expect(strongAgreement({ agree: ["screen", "screen_scale", "timezone"], conflict: ["lang"] })).toBe(false);
  });
});

describe("ipPrefixRange", () => {
  it("gives the /24 for IPv4 and the /64 for IPv6, as inet-comparable bounds", () => {
    expect(ipPrefixRange("203.0.113.77")).toEqual({ lo: "203.0.113.0", hi: "203.0.113.255", key: "203.0.113.0/24" });
    expect(ipPrefixRange("2600:1700:4e0:1a2b:9c1:ffff:fe00:1")).toEqual({
      lo: "2600:1700:4e0:1a2b::",
      hi: "2600:1700:4e0:1a2b:ffff:ffff:ffff:ffff",
      key: "2600:1700:4e0:1a2b::/64",
    });
    expect(ipPrefixRange("2600:1700:4e0::1")?.key).toBe("2600:1700:4e0:0::/64");
    expect(ipPrefixRange("::ffff:203.0.113.77")?.key).toBe("203.0.113.0/24");
  });

  it("returns null for garbage", () => {
    expect(ipPrefixRange(null)).toBeNull();
    expect(ipPrefixRange("not an ip")).toBeNull();
    expect(ipPrefixRange("1:2:3:4:5:6:7:8:9")).toBeNull();
  });
});

describe("pickMatch v2: fingerprint gate + network tier", () => {
  const phoneInstall: InstallForMatch = {
    ...install,
    device_model: "iPhone17,4",
    os_version: "26.6.1",
    screen_scale: 3,
    screen_w: 375,
    screen_h: 812,
    timezone: "America/New_York",
    locale: "en-US",
  };
  const igClick = (over: Partial<ClickCandidate>) => click({ ...parseClickUa(IG_UA), ...over });
  const fbClick = (over: Partial<ClickCandidate>) => click({ ...parseClickUa(FB_UA), ...over });

  it("rejects a same-IP click from a different phone (the NAT neighbour)", () => {
    expect(pickMatch(phoneInstall, [fbClick({})])).toBeNull();
    expect(pickMatch(phoneInstall, [igClick({})])?.confidence).toBe("high");
  });

  it("uses the fingerprint to break a same-IP tie without an ambiguity notch", () => {
    const m = pickMatch(phoneInstall, [
      fbClick({ click_id: "other-phone", clicked_at: iso(5 * MIN) }),
      igClick({ click_id: "this-phone", clicked_at: iso(30 * MIN) }),
    ]);
    expect(m?.click?.click_id).toBe("this-phone");
    expect(m?.confidence).toBe("high");
    expect(m?.agreed).toContain("model");
  });

  it("still matches fingerprint-less clicks on the exact IP (v1 behaviour, Safari + no beacon)", () => {
    expect(pickMatch(phoneInstall, [click({})])?.method).toBe("exact_ip");
  });

  it("network tier: same /24, strong agreement -> medium, method network", () => {
    const m = pickMatch(phoneInstall, [igClick({ ip: "203.0.113.200", clicked_at: iso(2 * HOUR) })]);
    expect(m?.method).toBe("network");
    expect(m?.confidence).toBe("medium");
    expect(pickMatch(phoneInstall, [igClick({ ip: "203.0.113.200", clicked_at: iso(2 * DAY) })])?.confidence).toBe("low");
  });

  it("network tier needs strong agreement: a bare IP neighbour or a Safari click never qualifies", () => {
    expect(pickMatch(phoneInstall, [click({ ip: "203.0.113.200" })])).toBeNull();
    expect(pickMatch(phoneInstall, [click({ ip: "203.0.113.200", model: "iPhone17,4" })])).toBeNull(); // model alone
    expect(pickMatch(phoneInstall, [igClick({ ip: "198.51.100.9" })])).toBeNull(); // different /24
  });

  it("network tier via the beacon alone (Safari): screen + dpr + timezone", () => {
    const beaconed = click({
      ip: "203.0.113.200",
      screen_w: 375,
      screen_h: 812,
      screen_scale: 3,
      timezone: "America/New_York",
    });
    expect(pickMatch(phoneInstall, [beaconed])?.method).toBe("network");
  });

  it("prefers any exact-IP survivor over a better-looking network candidate", () => {
    const m = pickMatch(phoneInstall, [
      click({ click_id: "exact-bare", clicked_at: iso(3 * HOUR) }),
      igClick({ click_id: "neighbour", ip: "203.0.113.200", clicked_at: iso(5 * MIN) }),
    ]);
    expect(m?.click?.click_id).toBe("exact-bare");
    expect(m?.method).toBe("exact_ip");
  });

  it("notches ambiguity inside the network tier too", () => {
    const m = pickMatch(phoneInstall, [
      igClick({ click_id: "a", ip: "203.0.113.200", clicked_at: iso(2 * HOUR) }),
      igClick({ click_id: "b", ip: "203.0.113.201", clicked_at: iso(1 * HOUR) }),
    ]);
    expect(m?.click?.click_id).toBe("b");
    expect(m?.confidence).toBe("low");
  });
});

// ── v3: Android install referrers decide before the IP tiers ───────────

describe("pickMatch v3: install referrers come first", () => {
  const OUR_CLICK = "3f2b8c1e-9a4d-4e6f-8b7a-0c1d2e3f4a5b";
  const META_AD = { campaign_id: "120230000000000001", adset_id: "120230000000000002", ad_id: "120230000000000003", account_id: "1234567890" };
  const OTHER_AD = { ...META_AD, campaign_id: "120230000000000099" };
  const android: InstallForMatch = { ip: "203.0.113.7", platform: "android", first_open_at: new Date(T0).toISOString() };
  const withRef = (referrer: Partial<NonNullable<InstallForMatch["referrer"]>>, over: Partial<InstallForMatch> = {}): InstallForMatch => ({
    ...android,
    ...over,
    referrer: { play_click_id: null, play_meta: null, meta: null, ...referrer },
  });
  // a fresh, unambiguous same-IP click: the best the IP tiers can do
  const ipClick = click({ click_id: "ip-click", platform_hint: "android", clicked_at: iso(5 * MIN) });

  it("THE ORDER: own click id > Meta ad in the Play referrer > Meta referrer > exact_ip > network", () => {
    const named = click({ click_id: OUR_CLICK, platform_hint: "android", ip: "198.51.100.9", clicked_at: iso(2 * DAY) });
    const all = withRef({ play_click_id: OUR_CLICK, play_meta: META_AD, meta: OTHER_AD });

    // 1. our click id wins over everything, including a fresher same-IP click
    const m1 = pickMatch(all, [ipClick, named]);
    expect(m1).toMatchObject({ method: "play_referrer", confidence: "high" });
    expect(m1?.click?.click_id).toBe(OUR_CLICK);

    // 2. without it, the Meta ad Play names
    const m2 = pickMatch(withRef({ play_meta: META_AD, meta: OTHER_AD }), [ipClick]);
    expect(m2).toMatchObject({ method: "play_referrer", confidence: "high", click: null, ad: META_AD });

    // 3. without that, the Meta referrer
    const m3 = pickMatch(withRef({ meta: OTHER_AD }), [ipClick]);
    expect(m3).toMatchObject({ method: "meta_referrer", confidence: "high", click: null, ad: OTHER_AD });

    // 4. with no referrer evidence the IP tiers are exactly as before
    expect(pickMatch(withRef({}), [ipClick])).toMatchObject({ method: "exact_ip", confidence: "high" });
    expect(pickMatch(android, [ipClick])?.click?.click_id).toBe("ip-click");
  });

  it("matches the named click exactly: other network, other platform hint, a week and more old", () => {
    const named = click({ click_id: OUR_CLICK, ip: "198.51.100.9", platform_hint: "other", clicked_at: iso(20 * DAY) });
    const m = pickMatch(withRef({ play_click_id: OUR_CLICK }), [named]);
    expect(m?.click?.click_id).toBe(OUR_CLICK);
    expect(m?.method).toBe("play_referrer");
    expect(m?.confidence).toBe("high");
  });

  it("is not fooled by fingerprint conflicts, ambiguity or a wrong phone clock", () => {
    const named = click({ click_id: OUR_CLICK, model: "SM-S918B", clicked_at: iso(-3 * HOUR) }); // "after" the install
    const m = pickMatch(withRef({ play_click_id: OUR_CLICK }, { device_model: "Pixel 9" }), [
      click({ click_id: "a", platform_hint: "android", clicked_at: iso(2 * MIN) }),
      click({ click_id: "b", platform_hint: "android", clicked_at: iso(1 * MIN) }),
      named,
    ]);
    expect(m?.click?.click_id).toBe(OUR_CLICK);
    expect(m?.confidence).toBe("high"); // no ambiguity notch on an exact match
  });

  it("finds the named click even when it is the echo of a double-loaded tap", () => {
    const m = pickMatch(withRef({ play_click_id: OUR_CLICK }), [
      click({ click_id: "first", fbclid: "PAZ9", platform_hint: "android", clicked_at: iso(10 * MIN) }),
      click({ click_id: OUR_CLICK, fbclid: "PAZ9", platform_hint: "android", clicked_at: iso(10 * MIN - 2000) }),
    ]);
    expect(m?.click?.click_id).toBe(OUR_CLICK);
  });

  it("matches click ids case-insensitively", () => {
    const m = pickMatch(withRef({ play_click_id: OUR_CLICK.toUpperCase() }), [click({ click_id: OUR_CLICK })]);
    expect(m?.method).toBe("play_referrer");
  });

  it("a click id we have no row for falls through to the next tier", () => {
    // the row was never logged (bot filter) or the fetch failed
    expect(pickMatch(withRef({ play_click_id: OUR_CLICK, meta: META_AD }), [ipClick])?.method).toBe("meta_referrer");
    expect(pickMatch(withRef({ play_click_id: OUR_CLICK }), [ipClick])?.method).toBe("exact_ip");
    expect(pickMatch(withRef({ play_click_id: OUR_CLICK }), [])).toBeNull();
  });

  it("needs no IP and no parseable first_open_at for a referrer verdict", () => {
    const blind = withRef({ meta: META_AD }, { ip: null, first_open_at: "garbage" });
    expect(pickMatch(blind, [])).toMatchObject({ method: "meta_referrer", ad: META_AD });
    // ...while the IP tiers still need both
    expect(pickMatch({ ...android, ip: null }, [ipClick])).toBeNull();
  });

  it("a decoded ad without a campaign id is not a match", () => {
    const nameless = { ...META_AD, campaign_id: null };
    expect(pickMatch(withRef({ play_meta: nameless, meta: nameless }), [])).toBeNull();
    expect(pickMatch(withRef({ play_meta: nameless }), [ipClick])?.method).toBe("exact_ip");
  });
});

describe("storeUrlFor with a click id (the Play install referrer)", () => {
  const ID = "3f2b8c1e-9a4d-4e6f-8b7a-0c1d2e3f4a5b";

  it("Android: appends the click id as a percent-encoded referrer Play hands back to the app", () => {
    const url = new URL(storeUrlFor("android", ID));
    expect(url.origin + url.pathname).toBe("https://play.google.com/store/apps/details");
    expect(url.searchParams.get("id")).toBe("com.dreamme.app");
    // what the app reads back at first open, and what the matcher parses
    expect(url.searchParams.get("referrer")).toBe(`utm_source=dreamme_link&dm_click=${ID}`);
    expect(storeUrlFor("android", ID)).toContain("&referrer=utm_source%3Ddreamme_link%26dm_click%3D");
  });

  it("iOS and unknown platforms are untouched; a malformed id adds nothing", () => {
    expect(storeUrlFor("ios", ID)).toBe(storeUrlFor("ios"));
    expect(storeUrlFor("other", ID)).toBe(storeUrlFor("other"));
    expect(storeUrlFor("android", "not-a-uuid")).toBe(storeUrlFor("android"));
    expect(storeUrlFor("android")).not.toContain("referrer");
  });
});
