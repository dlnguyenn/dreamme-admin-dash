import { describe, expect, it } from "vitest";
import {
  AREAS,
  STATUS_ORDER,
  buildParity,
  coverage,
  daysSince,
  groupAdsBySet,
  scoreboard,
  singularRead,
  toAdRow,
  toCampaignRow,
  toSnapshot,
  trialToPaid,
  type MmpSnapshot,
} from "@/lib/mmp/parity";
import { AGA_NOTES, CANT_COPY, JOBS, MECHANICS, PLAN } from "@/lib/mmp/catalog";

const NOW = new Date("2026-11-06T00:05:00Z");

/** The live mmp_snapshot row on 2026-11-06, as PostgREST returns it (numerics as strings). */
const RAW: Record<string, unknown> = {
  generated_at: "2026-11-06T00:01:39.940719+00:00",
  trials: 2395,
  trials_ios: 1953,
  trials_android: 442,
  trials_with_install: 2314,
  trials_click_matched: 17,
  installs: 12377,
  installs_ios: 9726,
  installs_android: 2651,
  installs_matched: 263,
  android_with_referrer: 0,
  last_install_at: "2026-11-06T00:01:17.35+00:00",
  clicks: 1128,
  clicks_tagged: 913,
  last_tagged_click_at: "2026-10-21T13:51:05.018+00:00",
  skan_postbacks: 2360,
  skan_valid: 2360,
  skan_trials: 596,
  skan_cv_null: 516,
  skan_redownloads: 56,
  skan_view_through: 299,
  skan_later_windows: 2,
  skan_apple_ads: 38,
  skan_unmapped: 0,
  last_postback_at: "2026-11-05T23:37:09.209374+00:00",
  meta_spend: "29107.92",
  meta_installs: 6106,
  meta_trials: 2463,
  meta_last_date: "2026-11-05",
  rc_paid: 642,
  rc_revenue: "43163.92",
  sng_tracker_installs: 2986,
  sng_trials: 0,
  sng_spend: "0",
  sng_synced_at: "2026-11-05T17:11:39.054+00:00",
  capi_qualified: 2278,
  capi_qualified_sent: 1924,
  capi_qualified_last: "2026-11-05T19:04:10.499365+00:00",
  capi_engaged: 2394,
  capi_engaged_last: "2026-11-06T00:00:03.131013+00:00",
  capi_attr: 274,
  capi_attr_last: "2026-10-24T12:30:03.64007+00:00",
  tiktok_events: 0,
  tiktok_events_sent: 0,
  tiktok_cost_last_date: null,
  manual_spend_rows: 0,
  aud_audiences: 3,
  aud_suppression_members: 0,
  aud_snapshot_rows: 9,
  aud_snapshot_last_run: "2026-09-28T08:24:36.247+00:00",
  alerts_open: 198,
  alerts_last_date: "2026-11-04",
  retention_cohorts: 2,
  survey_total: 8169,
  survey_facebook: 3572,
  survey_instagram: 1221,
  survey_tiktok: 1103,
  survey_app_store: 1373,
  installs_meta_deferred: 80,
  trials_meta_deferred: 8,
  sng_ad_trials: 0,
  sng_ads_with_trials: 0,
  survey_friend_family: 341,
  sng_paid_35d: 0,
  sng_trials_mature: 444,
  sng_paid_mature: 0,
};

const snap = (over: Partial<MmpSnapshot> = {}): MmpSnapshot => ({ ...toSnapshot(RAW), ...over });
const statusOf = (s: MmpSnapshot, id: string) => buildParity(s, NOW).find((r) => r.id === id)!.status;

describe("toSnapshot", () => {
  it("turns PostgREST numeric strings into numbers and keeps dates as strings", () => {
    const s = toSnapshot(RAW);
    expect(s.meta_spend).toBeCloseTo(29107.92);
    expect(s.sng_spend).toBe(0);
    expect(s.meta_last_date).toBe("2026-11-05");
    expect(s.tiktok_cost_last_date).toBeNull();
  });

  it("keeps a null SKAN count null on a campaign row, so no-data is not shown as zero", () => {
    const row = toCampaignRow({ campaign_id: "1", campaign_name: "A", spend: "6490.1", meta_installs: 1881, meta_trials: 557, skan_trials: null, clicks: 0, matched_installs: 0, matched_trials: 0, singular_installs: "2822" });
    expect(row.skan_trials).toBeNull();
    expect(row.spend).toBeCloseTo(6490.1);
    expect(row.singular_installs).toBe(2822);
    expect(row.singular_trials).toBe(0);
  });
});

describe("daysSince", () => {
  it("handles dates, timestamps and missing values", () => {
    expect(daysSince("2026-11-05", NOW)).toBe(1);
    expect(daysSince("2026-10-21T13:51:05.018+00:00", NOW)).toBe(15);
    expect(daysSince(null, NOW)).toBeNull();
  });
});

describe("buildParity on the live snapshot", () => {
  const rows = buildParity(snap(), NOW);

  it("has unique ids, a known area and complete text on every module", () => {
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    for (const r of rows) {
      expect(AREAS).toContain(r.area);
      expect(r.name.length).toBeGreaterThan(3);
      expect(r.appsflyer.length).toBeGreaterThan(20);
      expect(r.ours.length).toBeGreaterThan(10);
      expect(r.evidence.length).toBeGreaterThan(5);
      expect(r.evidence).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  it("reads today's state: collector live, click matching idle, audiences broken", () => {
    const s = snap();
    expect(statusOf(s, "skan-collect")).toBe("live");
    expect(statusOf(s, "click-matching")).toBe("idle");
    expect(statusOf(s, "web-to-app")).toBe("idle");
    expect(statusOf(s, "audiences")).toBe("broken");
    expect(statusOf(s, "android-referrer")).toBe("missing");
    expect(statusOf(s, "postbacks-meta")).toBe("live");
    expect(statusOf(s, "postbacks-tiktok")).toBe("idle");
    expect(statusOf(s, "srn")).toBe("blocked");
    expect(statusOf(s, "revenue")).toBe("live");
    expect(statusOf(s, "alerts")).toBe("partial");
    expect(statusOf(s, "deferred-deep-link")).toBe("partial");
    expect(statusOf(s, "invites")).toBe("missing");
    expect(statusOf(s, "uninstalls")).toBe("missing");
    expect(statusOf(s, "product-analytics")).toBe("live");
    for (const id of ["consent", "ad-revenue", "push-reengagement", "other-surfaces", "privacy"]) expect(statusOf(s, id), id).toBe("skip");
    expect(statusOf(s, "postbacks-singular")).toBe("missing");
    expect(statusOf(s, "creative")).toBe("partial");
  });

  it("covers every capability in AppsFlyer's public SDK API (React Native plugin docs, Nov 2026)", () => {
    // Each SDK method group maps to the module that answers it on the DAD.
    const covers: Record<string, string> = {
      "logEvent / AFInAppEventType": "postbacks-meta",
      "setCustomerUserId": "revenue",
      "validateAndLogInAppPurchase / Purchase Connector": "revenue",
      "setUserEmail / setUserPhone (hashed matching)": "postbacks-meta",
      "generateInviteLink / logInvite": "invites",
      "registerConversionListener / UDL / deferred deep links": "deferred-deep-link",
      "OneLink domains and deep link URLs": "onelink",
      "updateServerUninstallToken": "uninstalls",
      "sendPushNotificationData / handlePushNotification": "push-reengagement",
      "setConsentData / enableTCFDataCollection": "consent",
      "logAdRevenue": "ad-revenue",
      "logCrossPromoteImpression / setPreinstallAttribution / setOutOfStore": "other-surfaces",
      "setDisableAppleAdsAttribution": "apple-ads",
      "setDisableSKAdNetwork": "skan-collect",
      "anonymizeUser / setSharingFilterForPartners": "privacy",
    };
    const ids = new Set(rows.map((r) => r.id));
    for (const [api, id] of Object.entries(covers)) expect(ids.has(id), api).toBe(true);
  });

  it("everything that still needs work says what the next step is", () => {
    for (const r of rows) {
      if (["idle", "broken", "missing", "blocked"].includes(r.status)) expect(r.next, r.id).not.toBe("");
    }
  });

  it("scoreboard counts every module exactly once", () => {
    const score = scoreboard(rows);
    expect(STATUS_ORDER.reduce((a, k) => a + score[k], 0)).toBe(rows.length);
    expect(score.blocked).toBe(1);
  });
});

describe("statuses move with the data", () => {
  it("click matching goes live when an ad click is recent", () => {
    expect(statusOf(snap({ last_tagged_click_at: "2026-11-04T10:00:00Z" }), "click-matching")).toBe("live");
  });

  it("the Android referrer goes live once any install carries one, and drops its next step", () => {
    const row = buildParity(snap({ android_with_referrer: 40 }), NOW).find((r) => r.id === "android-referrer")!;
    expect(row.status).toBe("live");
    expect(row.next).toBe("");
  });

  it("audiences are live only with a recent snapshot and a non-empty suppression audience", () => {
    expect(statusOf(snap({ aud_snapshot_last_run: "2026-11-02T08:00:00Z" }), "audiences")).toBe("broken");
    expect(statusOf(snap({ aud_snapshot_last_run: "2026-11-02T08:00:00Z", aud_suppression_members: 2400 }), "audiences")).toBe("live");
  });

  it("the SKAN collector is broken when postbacks stop or signatures fail, partial with unmapped campaigns", () => {
    expect(statusOf(snap({ last_postback_at: "2026-10-30T00:00:00Z" }), "skan-collect")).toBe("broken");
    expect(statusOf(snap({ skan_valid: 2000 }), "skan-collect")).toBe("broken");
    expect(statusOf(snap({ skan_unmapped: 12 }), "skan-collect")).toBe("partial");
  });

  it("the Meta event sender is broken when trial_qualified stops", () => {
    const row = buildParity(snap({ capi_qualified_last: "2026-10-30T00:00:00Z" }), NOW).find((r) => r.id === "postbacks-meta")!;
    expect(row.status).toBe("broken");
    expect(row.next).not.toBe("");
  });

  it("an empty account does not divide by zero", () => {
    const zero = Object.fromEntries(Object.entries(toSnapshot(RAW)).map(([k, v]) => [k, typeof v === "number" ? 0 : null])) as unknown as MmpSnapshot;
    for (const r of buildParity(zero, NOW)) expect(r.evidence).not.toMatch(/NaN|Infinity/);
  });
});

describe("coverage and Singular", () => {
  it("lists each method against RevenueCat's trials", () => {
    const cov = coverage(snap());
    expect(cov.find((c) => c.id === "rc")).toMatchObject({ value: 2395, of: 2395 });
    expect(cov.find((c) => c.id === "click")!.value).toBe(17);
    expect(cov.find((c) => c.id === "meta")!.value).toBeGreaterThan(2395);
    expect(cov.find((c) => c.id === "singular")!.value).toBe(0);
  });

  it("Singular is idle with no trials, partial with trials but no cost, live with both, broken when the sync stops", () => {
    expect(singularRead(snap(), NOW).status).toBe("idle");
    expect(singularRead(snap({ sng_trials: 40 }), NOW).status).toBe("partial");
    expect(singularRead(snap({ sng_trials: 40, sng_spend: 9000 }), NOW).status).toBe("live");
    expect(singularRead(snap({ sng_synced_at: "2026-10-20T00:00:00Z" }), NOW).status).toBe("broken");
  });

  it("partner-only attribution counts as partly covered once Singular reports trials", () => {
    expect(statusOf(snap(), "srn")).toBe("blocked");
    expect(statusOf(snap({ sng_trials: 40 }), "srn")).toBe("partial");
  });
});

describe("paid conversions through Singular", () => {
  it("the Singular feed goes live once any conversion arrives, and drops its setup step", () => {
    const row = buildParity(snap({ sng_paid_35d: 12 }), NOW).find((r) => r.id === "postbacks-singular")!;
    expect(row.status).toBe("live");
    expect(row.next).toBe("");
    expect(row.evidence).toContain("12 paid conversions");
  });

  it("creative optimization is live only with enough mature trials and some conversions", () => {
    expect(statusOf(snap({ sng_paid_35d: 12, sng_paid_mature: 0 }), "creative")).toBe("partial");
    expect(statusOf(snap({ sng_paid_35d: 150, sng_trials_mature: 444, sng_paid_mature: 140 }), "creative")).toBe("live");
    expect(statusOf(snap({ sng_paid_35d: 5, sng_trials_mature: 10, sng_paid_mature: 4 }), "creative")).toBe("partial");
  });

  it("trialToPaid needs the minimum number of mature trials", () => {
    expect(trialToPaid(19, 5)).toBeNull();
    expect(trialToPaid(20, 5)).toBe(0.25);
  });
});

describe("ad rows", () => {
  const ad = (o: Record<string, unknown>) =>
    toAdRow({ campaign_id: "C1", campaign_name: "SCALING Campaign (iOS)", adset_id: "S1", adset_name: "DreamMe Statics", spend: 0, meta_installs: 0, meta_trials: 0, singular_installs: 0, singular_trials: 0, ...o });

  it("turns Singular's unnamed ad into a null id, and strings into numbers", () => {
    const r = ad({ ad_id: "", ad_name: null, spend: "12.5", singular_trials: "3" });
    expect(r.ad_id).toBeNull();
    expect(r.spend).toBe(12.5);
    expect(r.singular_trials).toBe(3);
  });

  it("groups ads under their ad set, sums the set, and folds tiny ads into the totals only", () => {
    const { groups, hiddenAds } = groupAdsBySet([
      ad({ ad_id: "A1", ad_name: "Newspaper", spend: 12320, meta_trials: 1074, singular_installs: 1489, singular_trials: 388 }),
      ad({ ad_id: "A2", ad_name: "Comic sans", spend: 2844, meta_trials: 193, singular_installs: 419, singular_trials: 76 }),
      ad({ ad_id: "A3", ad_name: "Tiny", spend: 4, meta_trials: 1 }),
      ad({ ad_id: null, singular_installs: 6, singular_trials: 1 }),
      ad({ adset_id: "S2", adset_name: "DreamMe Videos", ad_id: "B1", ad_name: "Danielle", spend: 1286, meta_trials: 194, singular_installs: 334, singular_trials: 83 }),
    ]);
    expect(groups.map((g) => g.adset_name)).toEqual(["DreamMe Statics", "DreamMe Videos"]);
    expect(groups[0]).toMatchObject({ spend: 15168, meta_trials: 1268, singular_installs: 1914, singular_trials: 465 });
    expect(groups[0].ads.map((a) => a.ad_name ?? "unnamed")).toEqual(["Newspaper", "Comic sans", "unnamed"]);
    expect(hiddenAds).toBe(1);
  });

  it("leaves out small ad sets with no Singular data and says how much spend they hold", () => {
    const { groups, hiddenSets, hiddenSpend } = groupAdsBySet([
      ad({ ad_id: "A1", spend: 12320, singular_installs: 1489, singular_trials: 388 }),
      ad({ campaign_id: "W1", adset_id: "T1004", adset_name: "T1004_proven_winners", ad_id: "W", spend: 266 }),
      ad({ campaign_id: "W2", adset_id: "L1018", adset_name: "L1018", ad_id: "L", spend: 120, singular_installs: 3 }),
    ]);
    expect(groups.map((g) => g.adset_name)).toEqual(["DreamMe Statics", "L1018"]);
    expect(hiddenSets).toBe(1);
    expect(hiddenSpend).toBe(266);
  });
});

describe("catalog", () => {
  it("has the three jobs, the rules table, the AGA notes and an ordered plan", () => {
    expect(JOBS).toHaveLength(3);
    expect(MECHANICS.length).toBeGreaterThanOrEqual(10);
    expect(AGA_NOTES.length).toBeGreaterThanOrEqual(4);
    expect(PLAN.length).toBeGreaterThanOrEqual(8);
    expect(CANT_COPY).toHaveLength(3);
    expect(new Set(PLAN.map((p) => p.title)).size).toBe(PLAN.length);
  });
});
