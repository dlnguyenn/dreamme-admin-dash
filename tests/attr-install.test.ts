import { describe, expect, it } from "vitest";
import {
  InstallBody,
  constEq,
  clientIp,
  stripNul,
  verdictGuard,
  verdictPatch,
  withoutReferrerColumns,
} from "@/lib/attr-installs";
import { REFERRER_COLUMNS, resolveReferrers } from "@/lib/attr-referrer";
import type { MatchVerdict } from "@/lib/attr-match";

/** The exact payload shape the RN SDK builds (lib/attribution/ in the iOS
 *  repo) — if this drifts, the app ships a ping the server rejects and,
 *  with no OTA channel, the bug lives until the next App Store release.
 *  Keep this fixture in lockstep with the SDK's buildPayload(). */
const SDK_PAYLOAD = {
  install_id: "0b6ef8a2-2f9f-4f24-9a0f-1de1a4b3c111",
  first_open_at: "2026-08-28T04:12:33.000Z",
  platform: "ios",
  os_version: "18.6",
  device_model: "iPhone17,2",
  locale: "en-US",
  timezone: "America/Los_Angeles",
  screen_w: 393,
  screen_h: 852,
  screen_scale: 3,
  idfv: "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
  app_version: "1.4.3",
  launch_url: "https://dreamme.life/go?fbclid=IwAR123abc",
  fbclid: "IwAR123abc",
};

/** The Android payload from sdk_version "3" on: the iOS shape plus the two
 *  install referrers. MIRROR of ANDROID_REFERRER_FIELDS in the app repo's
 *  __tests__/installAttribution.test.ts: same keys, same types, same units
 *  (seconds). Change one, change both. */
const ANDROID_SDK_PAYLOAD = {
  install_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  first_open_at: "2026-11-05T18:30:00.000Z",
  platform: "android",
  os_version: "36",
  device_model: "Pixel 9",
  locale: "en-US",
  timezone: "America/Chicago",
  screen_w: 412,
  screen_h: 915,
  screen_scale: 2.625,
  app_version: "1.5.6",
  sdk_version: "3",
  build_version: "112",
  app_installed_at: "2026-11-05T18:29:10.000Z",
  install_referrer: {
    referrer: "utm_source=dreamme_link&dm_click=3f2b8c1e-9a4d-4e6f-8b7a-0c1d2e3f4a5b",
    click_ts: 1793903300,
    install_begin_ts: 1793903340,
    click_server_ts: 1793903301,
    install_begin_server_ts: 1793903341,
    install_version: "1.5.6",
    google_play_instant: false,
  },
  meta_install_referrer: {
    install_referrer:
      '{"utm_campaign":"fb4a","utm_content":{"source":{"data":"7fb9bd76","nonce":"b7203c6a6fb633d16e9cf5c1"},"a":1214186473920093,"t":1793903000},"utm_source":"apps.instagram.com"}',
    actual_timestamp: 1793903000,
    is_ct: 1,
    source: "instagram",
  },
};

describe("InstallBody", () => {
  it("accepts the full SDK payload", () => {
    expect(InstallBody.parse(SDK_PAYLOAD).install_id).toBe(SDK_PAYLOAD.install_id);
  });

  it("accepts the minimal first-boot payload (id + timestamp only)", () => {
    const min = { install_id: SDK_PAYLOAD.install_id, first_open_at: SDK_PAYLOAD.first_open_at };
    expect(() => InstallBody.parse(min)).not.toThrow();
  });

  it("accepts the auth-link re-send (full payload + app_user_id)", () => {
    const linked = { ...SDK_PAYLOAD, app_user_id: "f3d2a1b0-0000-4000-8000-123456789abc" };
    expect(InstallBody.parse(linked).app_user_id).toBeTruthy();
  });

  it("rejects a non-uuid install_id and a non-ISO timestamp", () => {
    expect(() => InstallBody.parse({ ...SDK_PAYLOAD, install_id: "not-a-uuid" })).toThrow();
    expect(() => InstallBody.parse({ ...SDK_PAYLOAD, first_open_at: "yesterday" })).toThrow();
  });

  it("accepts the Android payload with both install referrers, fields intact", () => {
    const body = InstallBody.parse(ANDROID_SDK_PAYLOAD);
    expect(body.install_referrer).toEqual(ANDROID_SDK_PAYLOAD.install_referrer);
    expect(body.meta_install_referrer).toEqual(ANDROID_SDK_PAYLOAD.meta_install_referrer);
    // and the extraction the route runs on it finds our click id
    expect(resolveReferrers(body, undefined).evidence.play_click_id).toBe("3f2b8c1e-9a4d-4e6f-8b7a-0c1d2e3f4a5b");
  });

  it("NEVER rejects a ping over a malformed referrer: the field is dropped, the install is kept", () => {
    // a 400 makes the SDK retry the whole ping on every launch, forever
    for (const bad of [
      { install_referrer: "a bare string" },
      { install_referrer: { referrer: "" } },
      { install_referrer: { referrer: "x", click_ts: 1793903300000 } }, // milliseconds
      { install_referrer: null },
      { meta_install_referrer: { install_referrer: "x".repeat(10_001) } },
      { meta_install_referrer: { install_referrer: "x", is_ct: 2 } },
      { meta_install_referrer: 7 },
    ]) {
      const body = InstallBody.parse({ ...ANDROID_SDK_PAYLOAD, ...bad });
      expect(body.install_id).toBe(ANDROID_SDK_PAYLOAD.install_id);
      const key = Object.keys(bad)[0] as "install_referrer" | "meta_install_referrer";
      expect(body[key]).toBeUndefined();
    }
  });

  it("an iOS ping carries no referrers and parses exactly as before", () => {
    const body = InstallBody.parse(SDK_PAYLOAD);
    expect(body.install_referrer).toBeUndefined();
    expect(body.meta_install_referrer).toBeUndefined();
  });

  it("rejects oversized fields rather than storing them", () => {
    expect(() => InstallBody.parse({ ...SDK_PAYLOAD, launch_url: "x".repeat(2_001) })).toThrow();
    expect(() => InstallBody.parse({ ...SDK_PAYLOAD, screen_w: 0 })).toThrow();
  });
});

describe("constEq", () => {
  it("matches equal strings and rejects unequal ones", () => {
    expect(constEq("abc123", "abc123")).toBe(true);
    expect(constEq("abc123", "abc124")).toBe(false);
  });

  it("handles length mismatches without throwing (hash-first)", () => {
    expect(constEq("short", "a-much-longer-candidate-token")).toBe(false);
    expect(constEq("", "anything")).toBe(false);
  });
});

describe("clientIp", () => {
  const reqWith = (xff: string | null) =>
    new Request("https://x.test", { headers: xff !== null ? { "x-forwarded-for": xff } : {} });

  it("takes the FIRST hop — the real client in Vercel's proxy chain", () => {
    expect(clientIp(reqWith("203.0.113.7, 172.16.0.1, 10.0.0.1"))).toBe("203.0.113.7");
  });

  it("handles a bare single-hop header and absence", () => {
    expect(clientIp(reqWith("2001:db8::1"))).toBe("2001:db8::1");
    expect(clientIp(reqWith(null))).toBeNull();
  });

  it("refuses absurdly long values instead of passing them to inet", () => {
    expect(clientIp(reqWith("x".repeat(200)))).toBeNull();
  });
});

describe("stripNul", () => {
  it("removes U+0000 from every string, key and nesting level, and leaves the rest alone", () => {
    const NUL = String.fromCharCode(0);
    const dirty = { a: "x" + NUL + "y", n: 3, b: [true, NUL, { ["k" + NUL]: "v" + NUL }], z: null };
    expect(stripNul(dirty)).toEqual({ a: "xy", n: 3, b: [true, "", { k: "v" }], z: null });
    // the result is storable: Postgres rejects the escape the original serialises to
    expect(JSON.stringify(dirty)).toContain("u0000");
    expect(JSON.stringify(stripNul(dirty))).not.toContain("u0000");
    expect(stripNul(ANDROID_SDK_PAYLOAD)).toEqual(ANDROID_SDK_PAYLOAD);
  });
});

describe("writes that survive an unapplied migration", () => {
  it("withoutReferrerColumns drops exactly the migration's columns and keeps raw", () => {
    const { columns } = resolveReferrers(InstallBody.parse(ANDROID_SDK_PAYLOAD), undefined);
    const row = { install_id: "x", platform: "android", raw: ANDROID_SDK_PAYLOAD, ...columns };
    const legacy = withoutReferrerColumns(row) as Record<string, unknown>;
    for (const c of REFERRER_COLUMNS) expect(legacy).not.toHaveProperty(c);
    expect(legacy).toEqual({ install_id: "x", platform: "android", raw: ANDROID_SDK_PAYLOAD });
    // raw still carries both referrers, which is what the DAD counts on
    expect(legacy.raw).toHaveProperty("install_referrer");
    expect(row.install_referrer).toBe(ANDROID_SDK_PAYLOAD.install_referrer.referrer); // input untouched
  });
});

describe("verdict writes", () => {
  const AD = {
    campaign_id: "120230000000000001",
    adset_id: "120230000000000002",
    ad_id: "120230000000000003",
    account_id: "1234567890",
  };
  const CLICK = {
    click_id: "3f2b8c1e-9a4d-4e6f-8b7a-0c1d2e3f4a5b",
    clicked_at: "2026-11-05T18:28:00.000Z",
    ip: null,
    platform_hint: "android",
    fbclid: null,
  };
  const NOW = "2026-11-05T18:30:01.000Z";
  const KEYED = {
    ref_source: "meta_referrer" as const,
    ref_campaign_id: AD.campaign_id,
    ref_adset_id: AD.adset_id,
    ref_ad_id: AD.ad_id,
    ref_account_id: null,
    ref_decoded: { meta: { campaign_group_id: AD.campaign_id } },
    install_referrer: "never written by a verdict",
  };

  it("an IP verdict only fills an undecided install; a referrer verdict may replace an IP one, never another referrer", () => {
    expect(verdictGuard("exact_ip")).toBe("matched_click_id=is.null&match_method=is.null");
    expect(verdictGuard("network")).toBe(verdictGuard("exact_ip"));
    expect(verdictGuard("play_referrer")).toBe(
      "or=(match_method.is.null,match_method.not.in.(play_referrer,meta_referrer))",
    );
    expect(verdictGuard("meta_referrer")).toBe(verdictGuard("play_referrer"));
  });

  it("a click verdict writes the click; a Meta-ad verdict writes a null click plus the ids it named", () => {
    const byClick: MatchVerdict = { click: CLICK, confidence: "high", method: "play_referrer", agreed: [] };
    expect(verdictPatch(byClick, NOW)).toEqual({
      matched_click_id: CLICK.click_id,
      match_method: "play_referrer",
      match_confidence: "high",
      updated_at: NOW,
    });

    const byAd: MatchVerdict = { click: null, confidence: "high", method: "meta_referrer", agreed: [], ad: AD };
    // ref_account_id is null so it is left alone; install_referrer is not a keyed column
    expect(verdictPatch(byAd, NOW, KEYED)).toEqual({
      matched_click_id: null,
      match_method: "meta_referrer",
      match_confidence: "high",
      updated_at: NOW,
      ref_source: "meta_referrer",
      ref_campaign_id: AD.campaign_id,
      ref_adset_id: AD.adset_id,
      ref_ad_id: AD.ad_id,
      ref_decoded: { meta: { campaign_group_id: AD.campaign_id } },
    });
  });

  it("an IP verdict never writes referrer columns", () => {
    const byIp: MatchVerdict = { click: CLICK, confidence: "medium", method: "exact_ip", agreed: [] };
    expect(Object.keys(verdictPatch(byIp, NOW, KEYED)).sort()).toEqual([
      "match_confidence",
      "match_method",
      "matched_click_id",
      "updated_at",
    ]);
  });
});
