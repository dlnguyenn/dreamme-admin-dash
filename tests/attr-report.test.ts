import { describe, expect, it } from "vitest";
import { buildAttributionReport } from "@/lib/attr-report";
import type { ReportClick, ReportInstall, ReportTrial } from "@/lib/attr-report";
import { cleanReportClicks } from "@/lib/attr-installs";

/**
 * Contract-first suite for the Attribution tab's report builder — pure
 * (clicks, installs, trials) -> report, so the whole funnel's arithmetic
 * is enumerable here. Joins under test:
 *   install -> click     via matched_click_id (the phase-2 matcher)
 *   trial   -> install   via dm_install_id first (3b), app_user_id fallback
 */

const click = (o: Partial<ReportClick>): ReportClick => ({
  click_id: "c1",
  clicked_at: "2026-08-27T10:00:00Z",
  ad_id: "ad-1",
  ad_name: "Video 15s",
  campaign_name: "EAC iOS",
  ...o,
});

const install = (o: Partial<ReportInstall>): ReportInstall => ({
  install_id: "i1",
  first_open_at: "2026-08-27T10:30:00Z",
  app_user_id: null,
  platform: "ios",
  matched_click_id: null,
  match_confidence: null,
  ...o,
});

const trial = (o: Partial<ReportTrial>): ReportTrial => ({
  app_user_id: "u1",
  dm_install_id: null,
  price_usd: null,
  event_at: "2026-08-27T11:00:00Z",
  ...o,
});

describe("buildAttributionReport", () => {
  it("returns an all-zero report for empty inputs", () => {
    const r = buildAttributionReport([], [], []);
    expect(r.totals).toEqual({
      clicks: 0,
      installs: 0,
      matched: 0,
      match_rate: 0,
      by_confidence: { high: 0, medium: 0, low: 0 },
      trials_linked: 0,
      attributed_trials: 0,
    });
    expect(r.per_ad).toEqual([]);
    expect(r.recent_installs).toEqual([]);
  });

  it("rolls a full click->install->trial chain into the ad row", () => {
    const r = buildAttributionReport(
      [click({})],
      [install({ matched_click_id: "c1", match_confidence: "high", app_user_id: "u1" })],
      [trial({ dm_install_id: "i1" })],
    );
    expect(r.totals.matched).toBe(1);
    expect(r.totals.match_rate).toBe(1);
    expect(r.totals.attributed_trials).toBe(1);
    expect(r.per_ad).toHaveLength(1);
    expect(r.per_ad[0]).toMatchObject({
      ad_id: "ad-1",
      ad_name: "Video 15s",
      campaign_name: "EAC iOS",
      clicks: 1,
      installs: 1,
      trials: 1,
    });
  });

  it("links trials by app_user_id when dm_install_id is absent (pre-3b events)", () => {
    const r = buildAttributionReport(
      [click({})],
      [install({ matched_click_id: "c1", match_confidence: "medium", app_user_id: "u1" })],
      [trial({ app_user_id: "u1", dm_install_id: null })],
    );
    expect(r.totals.trials_linked).toBe(1);
    expect(r.totals.attributed_trials).toBe(1);
    expect(r.per_ad[0].trials).toBe(1);
  });

  it("counts unmatched installs in totals but never in per-ad rows", () => {
    const r = buildAttributionReport(
      [click({})],
      [install({}), install({ install_id: "i2", matched_click_id: "c1", match_confidence: "low" })],
      [],
    );
    expect(r.totals.installs).toBe(2);
    expect(r.totals.matched).toBe(1);
    expect(r.totals.match_rate).toBe(0.5);
    expect(r.per_ad[0].installs).toBe(1);
  });

  it("a linked trial on an UNMATCHED install counts as linked but not attributed", () => {
    const r = buildAttributionReport(
      [],
      [install({ app_user_id: "u1" })],
      [trial({ app_user_id: "u1" })],
    );
    expect(r.totals.trials_linked).toBe(1);
    expect(r.totals.attributed_trials).toBe(0);
  });

  it("buckets confidence and aggregates clicks per ad", () => {
    const r = buildAttributionReport(
      [
        click({}),
        click({ click_id: "c2", ad_id: "ad-1" }),
        click({ click_id: "c3", ad_id: "ad-2", ad_name: "Static", campaign_name: "EAC iOS" }),
      ],
      [
        install({ matched_click_id: "c1", match_confidence: "high" }),
        install({ install_id: "i2", matched_click_id: "c2", match_confidence: "medium" }),
        install({ install_id: "i3", matched_click_id: "c3", match_confidence: "low" }),
      ],
      [],
    );
    expect(r.totals.by_confidence).toEqual({ high: 1, medium: 1, low: 1 });
    const ad1 = r.per_ad.find((a) => a.ad_id === "ad-1");
    expect(ad1).toMatchObject({ clicks: 2, installs: 2 });
  });

  it("sorts per-ad rows by trials, then installs; recent installs newest-first capped at 20", () => {
    const installs = Array.from({ length: 25 }, (_, i) =>
      install({
        install_id: `i${i}`,
        first_open_at: `2026-08-${String(1 + (i % 27)).padStart(2, "0")}T10:00:00Z`,
      }),
    );
    const r = buildAttributionReport(
      [click({}), click({ click_id: "c2", ad_id: "ad-2", ad_name: "B" })],
      [
        ...installs,
        install({ install_id: "w1", matched_click_id: "c2", match_confidence: "high", app_user_id: "u9" }),
        install({ install_id: "w2", matched_click_id: "c1", match_confidence: "high" }),
      ],
      [trial({ app_user_id: "u9" })],
    );
    expect(r.per_ad[0].ad_id).toBe("ad-2"); // has the trial
    expect(r.recent_installs).toHaveLength(20);
    const times = r.recent_installs.map((x) => Date.parse(x.first_open_at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("labels unknown-ad matches instead of dropping them", () => {
    // matched_click_id pointing at a click outside the fetched window
    const r = buildAttributionReport(
      [],
      [install({ matched_click_id: "ghost", match_confidence: "low" })],
      [],
    );
    expect(r.totals.matched).toBe(1);
    expect(r.per_ad[0]).toMatchObject({ ad_id: null, ad_name: "(click outside window)" });
  });
});

// ── report input cleaning (bots + duplicates) ──────────────────────────

describe("cleanReportClicks", () => {
  const IG_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/23G71 Instagram 448.0.0.39.66 (iPhone)";
  const raw = (o: Partial<ReportClick> & { ua?: string | null; ip?: string | null; fbclid?: string | null }) => ({
    ...click(o),
    ua: o.ua ?? IG_UA,
    ip: o.ip ?? "98.122.10.4",
    fbclid: o.fbclid ?? null,
  });

  it("drops crawler rows, Meta-network rows and double loads; keeps taps", () => {
    const out = cleanReportClicks([
      raw({ click_id: "tap", fbclid: "PAZ1", clicked_at: "2026-10-01T18:07:55.100Z" }),
      raw({ click_id: "echo", fbclid: "PAZ1", clicked_at: "2026-10-01T18:07:55.900Z" }),
      raw({ click_id: "crawler", ua: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)" }),
      raw({ click_id: "checker", ip: "57.141.3.17", fbclid: "IwZ1" }),
      raw({ click_id: "lib", ua: "Python/3.11 aiohttp/3.11.15" }),
    ]);
    expect(out.map((c) => c.click_id)).toEqual(["tap"]);
    // the report shape only: no ua/ip/fbclid leak into the API payload
    expect(Object.keys(out[0]).sort()).toEqual(["ad_id", "ad_name", "campaign_name", "click_id", "clicked_at"]);
  });
});
