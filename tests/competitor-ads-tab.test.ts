import { describe, expect, it } from "vitest";
import {
  addDays,
  briefFromAd,
  buildAdViews,
  buildCpps,
  buildIdentities,
  creativeKey,
  formatMix,
  indexRanks,
  isRiser,
  isSteady,
  launchMonths,
  parseLanding,
  rankStats,
  topicSurvival,
  topicsOf,
  type ArchiveAd,
  type CompetitorAdRow,
  type RankRow,
} from "@/lib/competitor-ads-tab/logic";
import { foreplayIdMap, hookId, parseArchiveFiles, parseCsv, parseHooksCsv, parseWithTextIds } from "@/lib/competitor-ads-tab/archive-import";

// Made-up ids and numbers throughout; no real competitor data in this repo.
const APP = "1234567890";
const CPP = "aaaabbbb-1111-2222-3333-444455556666";

function ad(over: Partial<CompetitorAdRow> = {}): CompetitorAdRow {
  return {
    id: over.ad_archive_id ?? "u1",
    ad_archive_id: "100",
    page_id: "p1",
    page_name: "Brand App",
    is_active: true,
    started_at: "2026-10-01T07:00:00Z",
    ended_at: null,
    first_seen_at: null,
    media_type: "video",
    format: null,
    thumbnail_url: null,
    video_archive_url: null,
    title: null,
    body: null,
    hook: null,
    angle: null,
    messaging_theme: null,
    cta_text: null,
    link_url: null,
    ad_library_url: null,
    collation_id: null,
    collation_count: null,
    media_asset_id: null,
    video_duration_s: null,
    eu_total_reach: null,
    display_name: "Brand App",
    is_partnership: false,
    impressions_rank: null,
    rank_prev: null,
    rank_peak: null,
    rank_bucket: null,
    ranked_at: null,
    ...over,
  };
}

/** Daily snapshots for one ad, newest day first in `ranks`. */
function ranksFor(id: string, latest: string, ranks: (number | null)[]): RankRow[] {
  return ranks.flatMap((r, i) => (r == null ? [] : [{ page_id: "p1", day: addDays(latest, -i), ad_archive_id: id, rank: r }]));
}

describe("parseLanding", () => {
  it("reads the App Store id and the Custom Product Page from an AppsFlyer link", () => {
    const l = parseLanding(`https://app.appsflyer.com/id${APP}?pid=metaweb_int&c={{campaign.name}}&af_ios_store_cpp=${CPP}`);
    expect(l).toEqual({ kind: "app_store", appId: APP, cpp: CPP });
  });
  it("handles a url-encoded link and a plain App Store link with ppid", () => {
    expect(parseLanding(`https://app.appsflyer.com/id${APP}?pid=x&c=%7B%7Bcampaign.name%7D%7D`).cpp).toBeNull();
    expect(parseLanding(`https://apps.apple.com/us/app/id${APP}?ppid=${CPP}`)).toEqual({ kind: "app_store", appId: APP, cpp: CPP });
  });
  it("tells Play and web apart and treats a missing link as none", () => {
    expect(parseLanding("https://app.appsflyer.com/com.example.app?pid=metaweb_int").kind).toBe("play");
    expect(parseLanding("https://play.google.com/store/apps/details?id=com.example.app").kind).toBe("play");
    expect(parseLanding("https://example.com/quiz?utm_medium=wpay").kind).toBe("web");
    expect(parseLanding(null).kind).toBe("none");
  });
});

describe("rank history", () => {
  const latest = "2026-11-21";
  it("reads now, 7 and 14 days ago and days in the top 20 over the window", () => {
    // 15 days: rank 1 today, 30 a week ago, 90 two weeks ago.
    const r = [1, 2, 3, 5, 8, 12, 20, 30, 40, 50, 60, 70, 80, 85, 90];
    const idx = indexRanks(ranksFor("a", latest, r));
    const s = rankStats(idx, "a");
    expect(s.now).toBe(1);
    expect(s.ago7).toBe(30);
    expect(s.ago14).toBe(90);
    expect(s.observed).toBe(14);
    expect(s.top20).toBe(7);
    expect(s.best).toBe(1);
  });
  it("looks back up to 2 days when the exact day has no snapshot", () => {
    const rows = [...ranksFor("a", latest, [4]), { page_id: "p1", day: addDays(latest, -9), ad_archive_id: "a", rank: 40 }];
    expect(rankStats(indexRanks(rows), "a").ago7).toBe(40);
  });
  it("flags fast risers and steady long-runners", () => {
    expect(isRiser({ now: 10, ago7: 35, ago14: null, top20: 0, top50: 0, observed: 14, best: 10 })).toBe(true);
    expect(isRiser({ now: 10, ago7: 25, ago14: null, top20: 0, top50: 0, observed: 14, best: 10 })).toBe(false);
    expect(isRiser({ now: 60, ago7: 200, ago14: null, top20: 0, top50: 0, observed: 14, best: 60 })).toBe(false);
    expect(isSteady({ now: 12, ago7: 9, ago14: 15, top20: 8, top50: 12, observed: 14, best: 5 }, 45)).toBe(true);
    expect(isSteady({ now: 12, ago7: 9, ago14: 15, top20: 8, top50: 12, observed: 14, best: 5 }, 20)).toBe(false);
  });
});

describe("buildAdViews", () => {
  const latest = "2026-11-21";
  const now = "2026-11-21T12:00:00Z";
  it("counts confidence only over the signals that exist for the ad", () => {
    const idx = indexRanks(ranksFor("100", latest, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]));
    const [v] = buildAdViews([ad({ ad_archive_id: "100" })], "Brand", idx, now, true);
    // rank, persistence and run length exist; copies and EU reach don't.
    expect(v.confidence.of).toBe(3);
    expect(v.confidence.met).toBe(3);
    expect(v.confidence.signals.map((s) => s.key)).toEqual(["rank", "persist", "run"]);
  });
  it("groups copies by the archived video file and shows no rank when the snapshot is stale", () => {
    const file = (n: string) => `https://x.supabase.co/storage/v1/object/public/b/competitor-ads/videos/${n}.mp4`;
    const rows = [
      ad({ id: "a", ad_archive_id: "1", video_archive_url: file("777") }),
      ad({ id: "b", ad_archive_id: "2", media_asset_id: "777" }),
      ad({ id: "c", ad_archive_id: "3", video_archive_url: file("777") }),
      ad({ id: "d", ad_archive_id: "4", video_archive_url: file("888"), collation_count: 5 }),
    ];
    expect(creativeKey(rows[0])).toBe(creativeKey(rows[1]));
    const idx = indexRanks(ranksFor("1", latest, [2]));
    const views = buildAdViews(rows, "Brand", idx, now, false);
    expect(views.map((v) => v.copies)).toEqual([3, 3, 3, 5]);
    expect(views[0].rank.now).toBeNull();
    expect(views[0].confidence.signals.find((s) => s.key === "rank")).toBeUndefined();
  });
  it("keeps Outlier's stored bucket and adds a computed riser", () => {
    const idx = indexRanks([...ranksFor("1", latest, [5]), { page_id: "p1", day: addDays(latest, -7), ad_archive_id: "1", rank: 80 }]);
    const [v] = buildAdViews([ad({ ad_archive_id: "1", rank_bucket: "evergreen" })], "Brand", idx, now, true);
    expect(v.buckets).toEqual(["evergreen", "riser"]);
  });
});

describe("identities, store pages and format mix", () => {
  const now = "2026-11-21T12:00:00Z";
  const idx = indexRanks([
    ...ranksFor("1", "2026-11-21", [4]),
    ...ranksFor("2", "2026-11-21", [30]),
    ...ranksFor("3", "2026-11-21", [12]),
  ]);
  const live = buildAdViews(
    [
      ad({ id: "a", ad_archive_id: "1", display_name: "creator_one", is_partnership: true, link_url: `https://app.appsflyer.com/id${APP}?af_ios_store_cpp=${CPP}`, hook: "hook a" }),
      ad({ id: "b", ad_archive_id: "2", display_name: "creator_one", is_partnership: true, link_url: `https://app.appsflyer.com/id${APP}?af_ios_store_cpp=${CPP}`, hook: "hook b", media_type: "unknown" }),
      ad({ id: "c", ad_archive_id: "3", display_name: "Brand App", link_url: `https://app.appsflyer.com/id${APP}?pid=x`, media_type: "dco" }),
    ],
    "Brand",
    idx,
    now,
    true,
  );
  it("rolls live ads up by identity with first seen across all ads", () => {
    const ids = buildIdentities(live, [{ page_id: "p1", display_name: "creator_one", started_at: "2026-08-01T00:00:00Z" }], () => "Brand");
    const c = ids.find((i) => i.identity === "creator_one")!;
    expect(c).toMatchObject({ live: 2, top20: 1, bestRank: 4, firstSeen: "2026-08-01T00:00:00Z", isPartnership: true });
  });
  it("counts an ad once across Outlier and archive rows, and lets archive names reach back", () => {
    const ids = buildIdentities(
      live,
      [
        { page_id: "p1", display_name: "creator_one", started_at: "2026-11-10T00:00:00Z", ad_archive_id: "1" },
        { page_id: "p1", display_name: null, started_at: "2026-08-20T00:00:00Z", ad_archive_id: "9" },
        { page_id: "p1", display_name: "creator_one", started_at: "2026-11-10T00:00:00Z", ad_archive_id: "1" },
        { page_id: "p1", display_name: "creator_one", started_at: "2026-08-14T00:00:00Z", ad_archive_id: "8" },
      ],
      () => "Brand",
    );
    const c = ids.find((i) => i.identity === "creator_one")!;
    expect(c).toMatchObject({ adsSeen: 2, firstSeen: "2026-08-14T00:00:00Z", live: 2 });
  });
  it("counts live ads per Custom Product Page and builds the public link", () => {
    const { pages, mix } = buildCpps(live);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ live: 2, bestRank: 4, url: `https://apps.apple.com/us/app/id${APP}?ppid=${CPP}` });
    expect(pages[0].sampleHooks[0]).toBe("hook a");
    expect(mix[0]).toMatchObject({ live: 3, appStoreCpp: 2, appStoreDefault: 1 });
  });
  it("puts ads with no captured creative in their own bucket", () => {
    expect(formatMix(live)).toEqual({ video: 1, dco: 1, image: 0, none: 1 });
  });
  it("writes a brief stub from the ad's own fields", () => {
    const text = briefFromAd(live[0], "first spoken line");
    expect(text).toContain("Delivery rank #4 today");
    expect(text).toContain(`ppid=${CPP}`);
    expect(text).toContain("Spoken: first spoken line");
  });
});

describe("launches and survival from the archive", () => {
  const pulled = "2026-11-21";
  const mk = (i: number, start: string, days: number, source = "foreplay"): ArchiveAd => ({
    ad_archive_id: String(i), page_id: "p1", brand: "b", source, pulled_on: pulled,
    started_at: `${start}T07:00:00Z`, running_days: days, live_at_pull: false, headline: i % 2 ? "Protein on a low appetite" : "Shot day checklist", description: null,
  });
  it("only counts a cohort towards 'lasted N' once N days have passed", () => {
    const ads = [
      ...Array.from({ length: 10 }, (_, i) => mk(i, "2026-10-05", i < 2 ? 40 : 3)),
      ...Array.from({ length: 6 }, (_, i) => mk(100 + i, "2026-11-18", 3)),
      mk(999, "2026-10-05", 60, "foreplay_spyder"),
    ];
    const [oct, nov] = launchMonths(ads);
    expect(oct).toMatchObject({ month: "2026-10", launched: 10, lasted7: 0.2, lasted30: 0.2 });
    expect(nov.lasted7).toBeNull();
    expect(nov.n7).toBe(0);
  });
  it("matches topics on headline and the first copy line, and leaves ranking-only rows out", () => {
    expect(topicsOf({ headline: "STILL SO CONSTIPATED", description: null })).toContain("fiber");
    const ads = Array.from({ length: 10 }, (_, i) => mk(i, "2026-09-01", i < 5 ? 20 : 2));
    const s = topicSurvival([...ads, mk(50, "2026-09-01", 90, "foreplay_spyder")]);
    expect(s.all.ads).toBe(10);
    expect(s.all.lasted14).toBe(0.5);
  });
});

describe("archive import parsers", () => {
  it("keeps ad ids past 2^53 exact", () => {
    const v = parseWithTextIds('{"data":[{"ad_id": 12345678901234567890}]}') as { data: { ad_id: string }[] };
    expect(v.data[0].ad_id).toBe("12345678901234567890");
  });
  it("merges archive and ranking files and keeps no media urls", () => {
    const archive = JSON.stringify({ data: [{ id: "fp1", ad_id: "11", started_running: Date.parse("2026-10-01"), running_duration: { days: 30 }, live: true, name: "Brand App", headline: "h", full_transcription: "spoken", video: "https://r2.example/x.mp4" }] });
    const spyder = `{"data":{"ads":[{"ad_id": 11, "ranking": {"rank": 3, "previous_rank": 9, "days_running": 31}, "timeProductWasMentioned": 12.5, "timestampedTranscription": [{"sentence":" hi","startTime":0,"endTime":1}]}, {"ad_id": 22, "startedRunning": ${Date.parse("2026-11-20")}, "ranking": {"rank": 40}, "live": true}]}}`;
    const { rows } = parseArchiveFiles(
      [{ name: "brand_spyder_rankings_2026-11-21.json", text: spyder }, { name: "brand_ads_p1.json", text: archive }],
      { brand: "p1" },
      "2026-11-21",
    );
    const a = rows.find((r) => r.ad_archive_id === "11")!;
    expect(a).toMatchObject({ source: "foreplay", running_days: 30, transcript: "spoken", archive_rank: 3, archive_rank_prev: 9, product_mention_s: 12.5 });
    expect(a.timed_transcript).toEqual([{ start: 0, end: 1, text: "hi" }]);
    expect(rows.find((r) => r.ad_archive_id === "22")!.source).toBe("foreplay_spyder");
    expect(JSON.stringify(rows)).not.toContain("r2.example");
  });
  it("reads the hook CSV, quoted commas included, and links hooks to ads", () => {
    const csv = '﻿rank,tier,score,brand,hook,identity,first_start,url\n1,A,97,brandx,"day 4 / shot day, checklist",Brand App,2026-09-21,https://app.foreplay.co/discovery?ad=fp1\n';
    const map = foreplayIdMap([{ name: "brandx_ads_p1.json", text: '{"data":[{"id":"fp1","ad_id":"11"}]}' }]);
    const [h] = parseHooksCsv(csv, "hooks.csv", map);
    expect(h).toMatchObject({ position: 1, brand: "brandx", hook: "day 4 / shot day, checklist", ad_archive_id: "11", first_start: "2026-09-21" });
    expect(h.id).toBe(hookId("brandx", "day 4 / shot day, checklist"));
    expect(parseCsv('a,"b ""c"""\n')).toEqual([["a", 'b "c"']]);
  });
});
