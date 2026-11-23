/**
 * Server side of the Competitor ads tab (src/components/competitor-ads/).
 *
 * Reads the tables Outlier's daily scrape fills in this same database
 * (competitor_brands, competitor_ads, competitor_ad_ranks,
 * competitor_brand_daily, video_analyses) plus the tab's own tables
 * (competitor_archive_ads, competitor_hooks, competitor_ad_saves, migration
 * 0122). Read-only towards Outlier's tables. Service role only; never import
 * this from a client component (pure rules live in logic.ts).
 *
 * Development only: before migration 0122 exists, COMPETITOR_ARCHIVE_LOCAL_DIR
 * (a folder of Foreplay pull files) and COMPETITOR_HOOKS_LOCAL_CSV (the ranked
 * hook CSV) are read from disk instead, and picks/saves are kept in memory.
 */
import * as fs from "fs";
import * as path from "path";
import { sbAll } from "@/lib/revenue-plan/db";
import { spGet, spPatch, spPost, spDelete } from "@/lib/support/db";
import { foreplayIdMap, parseArchiveFiles, parseHooksCsv, type HookRow } from "./archive-import";
import {
  addDays,
  buildAdViews,
  buildCpps,
  buildIdentities,
  formatMix,
  indexRanks,
  launchMonths,
  topicSurvival,
  type AdView,
  type ArchiveAd,
  type CompetitorAdRow,
  type CppView,
  type FormatMix,
  type IdentityView,
  type LandingMix,
  type LaunchMonth,
  type RankRow,
  type TopicSurvival,
} from "./logic";

const DEV = process.env.NODE_ENV !== "production";
const LOCAL_DIR = DEV ? process.env.COMPETITOR_ARCHIVE_LOCAL_DIR || "" : "";
const LOCAL_HOOKS = DEV ? process.env.COMPETITOR_HOOKS_LOCAL_CSV || "" : "";
/** Page ids for the local archive files' brand prefixes (public Ad Library ids). */
const LOCAL_PAGES: Record<string, string> = { meagain: "539227915950887", shotsy: "395893520263618" };

const AD_COLS =
  "id,ad_archive_id,page_id,page_name,is_active,started_at,ended_at,first_seen_at,media_type,format,thumbnail_url,video_archive_url,title,body,hook,angle,messaging_theme,cta_text,link_url,ad_library_url,collation_id,collation_count,media_asset_id,video_duration_s,eu_total_reach,display_name,display_page_id,is_partnership,impressions_rank,rank_prev,rank_peak,rank_bucket,ranked_at";

export type Source = "table" | "local" | "missing";

export interface BrandDay {
  day: string;
  active: number;
  video: number;
  image: number;
  dco: number;
  other: number;
  partnership: number;
  newAds: number;
  endedAds: number;
}

export interface BrandView {
  key: string;
  name: string;
  pages: { pageId: string; pageName: string | null; lastScrapedAt: string | null }[];
  live: number;
  mix: FormatMix;
  daily: BrandDay[];
  rankDay: string | null;
  rankDays: number;
  rankFresh: boolean;
}

export interface HookView extends HookRow {
  pick: "brief" | "maybe" | "skip" | null;
  pick_at: string | null;
  /** The stored frame of the matched ad (live or ended), when Outlier has one. */
  thumb?: string | null;
}

export interface SaveRow {
  ad_archive_id: string;
  page_id: string;
  note: string;
  saved_at: string;
}

export interface CompetitorAdsPayload {
  ok: true;
  generatedAt: string;
  brands: BrandView[];
  ads: AdView[];
  /** Saved ads that are no longer live (minimal view, no rank). */
  savedEnded: AdView[];
  identities: IdentityView[];
  cpps: CppView[];
  landing: LandingMix[];
  archive: {
    pulledOn: string | null;
    brands: { brand: string; months: LaunchMonth[]; survival: { all: TopicSurvival; topics: TopicSurvival[] } }[];
  };
  hooks: HookView[];
  saves: SaveRow[];
  sources: { archive: Source; hooks: Source; saves: Source };
}

const isMissingTable = (e: unknown) => /PGRST205|42P01|Could not find the table|does not exist/i.test(e instanceof Error ? e.message : String(e));

const brandName = (raw: string | null) => {
  const s = (raw ?? "").trim();
  if (!s) return "Unknown";
  return s.toLowerCase() === "meagain" ? "MeAgain" : s[0].toUpperCase() + s.slice(1);
};
const brandKey = (raw: string | null) => (raw ?? "").trim().toLowerCase() || "unknown";

// ---------------------------------------------------------------- local (dev) sources

let localArchiveCache: { full: ReturnType<typeof parseArchiveFiles>["rows"]; files: { name: string; text: string }[] } | null = null;

function localArchive() {
  if (!LOCAL_DIR) return null;
  if (localArchiveCache) return localArchiveCache;
  const files = fs
    .readdirSync(LOCAL_DIR)
    .filter((n) => /_(ads_p\d+|spyder_rankings_)[\w-]*\.json$/i.test(n))
    .map((name) => ({ name, text: fs.readFileSync(path.join(LOCAL_DIR, name), "utf8") }));
  const pulled = /(\d{4}-\d{2}-\d{2})/.exec(path.basename(LOCAL_DIR))?.[1] ?? new Date().toISOString().slice(0, 10);
  const { rows } = parseArchiveFiles(files, LOCAL_PAGES, pulled);
  localArchiveCache = { full: rows, files };
  return localArchiveCache;
}

/** Dev-only memory store for picks and saves while the tables don't exist. */
const memory = { picks: new Map<string, HookView["pick"]>(), saves: new Map<string, SaveRow>() };

async function readArchive(): Promise<{ rows: (ArchiveAd & { brand: string })[]; source: Source }> {
  try {
    const rows = await sbAll<ArchiveAd>(
      "internal",
      "competitor_archive_ads?select=ad_archive_id,page_id,brand,source,pulled_on,started_at,running_days,live_at_pull,headline,description,transcript,identity&order=ad_archive_id",
    );
    if (rows.length || !localArchive()) return { rows, source: "table" };
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  const local = localArchive();
  return local ? { rows: local.full, source: "local" } : { rows: [], source: "missing" };
}

async function readHooks(): Promise<{ rows: HookView[]; source: Source }> {
  try {
    const rows = await spGet<HookView[]>("competitor_hooks?select=*&order=position");
    if (rows.length || !LOCAL_HOOKS) return { rows, source: "table" };
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
  if (!LOCAL_HOOKS || !fs.existsSync(LOCAL_HOOKS)) return { rows: [], source: "missing" };
  const files = localArchive()?.files ?? [];
  const rows = parseHooksCsv(fs.readFileSync(LOCAL_HOOKS, "utf8"), path.basename(LOCAL_HOOKS), foreplayIdMap(files));
  return { rows: rows.map((h) => ({ ...h, pick: memory.picks.get(h.id) ?? null, pick_at: null })), source: "local" };
}

async function readSaves(): Promise<{ rows: SaveRow[]; source: Source }> {
  try {
    return { rows: await spGet<SaveRow[]>("competitor_ad_saves?select=ad_archive_id,page_id,note,saved_at&order=saved_at.desc"), source: "table" };
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    // Before migration 0122 runs the tab still loads; saving says why it can't.
    if (!DEV) return { rows: [], source: "missing" };
    return { rows: [...memory.saves.values()].sort((a, b) => b.saved_at.localeCompare(a.saved_at)), source: "local" };
  }
}

// ---------------------------------------------------------------- payload

export async function buildCompetitorAdsPayload(): Promise<CompetitorAdsPayload> {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const brandRows = await spGet<{ page_id: string; page_name: string | null; brand_name: string | null; last_scraped_at: string | null }[]>(
    "competitor_brands?select=page_id,page_name,brand_name,last_scraped_at&active=eq.true&order=brand_name",
  );
  const pageIds = brandRows.map((b) => b.page_id);
  const inPages = `page_id=in.(${pageIds.join(",")})`;
  const keyOfPage = new Map(brandRows.map((b) => [b.page_id, brandKey(b.brand_name)]));
  const nameOfKey = new Map(brandRows.map((b) => [brandKey(b.brand_name), brandName(b.brand_name)]));
  const brandOfPage = (p: string) => nameOfKey.get(keyOfPage.get(p) ?? "") ?? "Unknown";

  const [live, ranks, daily, allLite, archive, hooks, saves] = await Promise.all([
    pageIds.length ? sbAll<CompetitorAdRow>("internal", `competitor_ads?select=${AD_COLS}&is_active=eq.true&${inPages}&order=id`) : [],
    pageIds.length
      ? sbAll<RankRow>("internal", `competitor_ad_ranks?select=page_id,day,ad_archive_id,rank&source=eq.outlier&day=gte.${addDays(today, -16)}&${inPages}&order=day,page_id,ad_archive_id`)
      : [],
    pageIds.length
      ? sbAll<{ page_id: string; day: string; active: number; active_video: number; active_image: number; active_dco: number; active_other: number; active_partnership: number; new_ads: number | null; ended_ads: number | null }>(
          "internal",
          `competitor_brand_daily?select=page_id,day,active,active_video,active_image,active_dco,active_other,active_partnership,new_ads,ended_ads&day=gte.${addDays(today, -150)}&${inPages}&order=day,page_id`,
        )
      : [],
    pageIds.length ? sbAll<{ page_id: string; display_name: string | null; started_at: string | null; ad_archive_id: string }>("internal", `competitor_ads?select=page_id,display_name,started_at,ad_archive_id&${inPages}&order=id`) : [],
    readArchive(),
    readHooks(),
    readSaves(),
  ]);

  // Brands with more than one page (Glowise) roll up under one name.
  const keys = [...new Set(brandRows.map((b) => brandKey(b.brand_name)))];
  const ads: AdView[] = [];
  const brands: BrandView[] = keys.map((key) => {
    const pages = brandRows.filter((b) => brandKey(b.brand_name) === key);
    const name = nameOfKey.get(key) ?? key;
    let rankDay: string | null = null;
    let rankDays = 0;
    let rankFresh = false;
    for (const p of pages) {
      const idx = indexRanks(ranks.filter((r) => r.page_id === p.page_id));
      const fresh = !!idx.latestDay && idx.latestDay >= addDays(today, -2);
      if (idx.latestDay && (!rankDay || idx.latestDay > rankDay)) rankDay = idx.latestDay;
      rankDays = Math.max(rankDays, idx.days.length);
      rankFresh = rankFresh || fresh;
      ads.push(...buildAdViews(live.filter((a) => a.page_id === p.page_id), name, idx, now, fresh));
    }
    const mine = ads.filter((a) => a.brand === name);
    const byDay = new Map<string, BrandDay>();
    for (const d of daily.filter((d) => pages.some((p) => p.page_id === d.page_id))) {
      const v = byDay.get(d.day) ?? { day: d.day, active: 0, video: 0, image: 0, dco: 0, other: 0, partnership: 0, newAds: 0, endedAds: 0 };
      v.active += d.active;
      v.video += d.active_video;
      v.image += d.active_image;
      v.dco += d.active_dco;
      v.other += d.active_other;
      v.partnership += d.active_partnership;
      v.newAds += d.new_ads ?? 0;
      v.endedAds += d.ended_ads ?? 0;
      byDay.set(d.day, v);
    }
    return {
      key,
      name,
      pages: pages.map((p) => ({ pageId: p.page_id, pageName: p.page_name, lastScrapedAt: p.last_scraped_at })),
      live: mine.length,
      mix: formatMix(mine),
      daily: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      rankDay,
      rankDays,
      rankFresh,
    };
  });
  brands.sort((a, b) => b.live - a.live || a.name.localeCompare(b.name));
  ads.sort((a, b) => (a.rank.now ?? 1e9) - (b.rank.now ?? 1e9));

  // Saved ads that have ended: fetch them so the swipe file keeps them.
  const liveIds = new Set(ads.map((a) => a.adArchiveId));
  const endedIds = saves.rows.map((s) => s.ad_archive_id).filter((id) => !liveIds.has(id));
  let savedEnded: AdView[] = [];
  if (endedIds.length) {
    const rows = await spGet<CompetitorAdRow[]>(`competitor_ads?select=${AD_COLS}&ad_archive_id=in.(${endedIds.map(encodeURIComponent).join(",")})`);
    savedEnded = rows.flatMap((r) => buildAdViews([r], brandOfPage(r.page_id), indexRanks([]), now, false));
  }

  // Frames for archive hooks whose ad has ended (live ones come with the ads).
  const liveThumb = new Map(ads.map((a) => [a.adArchiveId, a.thumb]));
  const endedHookIds = [...new Set(hooks.rows.map((h) => h.ad_archive_id).filter((id): id is string => !!id && !liveIds.has(id)))];
  const endedThumbs = new Map<string, string | null>();
  if (endedHookIds.length) {
    const rows = await spGet<{ ad_archive_id: string; thumbnail_url: string | null }[]>(
      `competitor_ads?select=ad_archive_id,thumbnail_url&ad_archive_id=in.(${endedHookIds.map(encodeURIComponent).join(",")})`,
    ).catch(() => []);
    for (const r of rows) endedThumbs.set(r.ad_archive_id, r.thumbnail_url);
  }
  const hookRows = hooks.rows.map((h) => ({ ...h, thumb: h.ad_archive_id ? liveThumb.get(h.ad_archive_id) ?? endedThumbs.get(h.ad_archive_id) ?? null : null }));

  const { pages: cpps, mix: landing } = buildCpps(ads);
  const archiveBrands = [...new Set(archive.rows.map((r) => r.page_id))].map((pageId) => {
    const list = archive.rows.filter((r) => r.page_id === pageId);
    return {
      brand: keyOfPage.has(pageId) ? brandOfPage(pageId) : brandName(list[0]?.brand ?? null),
      months: launchMonths(list),
      survival: topicSurvival(list),
    };
  });

  return {
    ok: true,
    generatedAt: now,
    brands,
    ads: ads.map(trimAd),
    savedEnded: savedEnded.map(trimAd),
    // Outlier only names the account from Nov 5; Foreplay's partnership pull names older ads.
    identities: buildIdentities(
      ads,
      [
        ...allLite,
        ...archive.rows
          .filter((r) => r.identity && keyOfPage.has(r.page_id))
          .map((r) => ({ page_id: r.page_id, display_name: r.identity ?? null, started_at: r.started_at, ad_archive_id: r.ad_archive_id })),
      ],
      brandOfPage,
    ),
    cpps,
    landing,
    archive: { pulledOn: archive.rows.filter((r) => r.source === "foreplay").map((r) => r.pulled_on).sort().at(-1) ?? null, brands: archiveBrands },
    hooks: hookRows,
    saves: saves.rows,
    sources: { archive: archive.source, hooks: hooks.source, saves: saves.source },
  };
}

/** Keep the payload small: long ad copy is cut (the drawer links the Ad Library for the rest). */
function trimAd(a: AdView): AdView {
  return { ...a, body: a.body && a.body.length > 700 ? `${a.body.slice(0, 700)}…` : a.body };
}

// ---------------------------------------------------------------- launches (Creative tests view)

/** The columns the Creative tests view needs: enough to draw a row and open the drawer. */
const LAUNCH_COLS =
  "id,ad_archive_id,page_id,page_name,is_active,started_at,ended_at,media_type,format,thumbnail_url,video_archive_url,title,body,hook,angle,messaging_theme,cta_text,link_url,ad_library_url,collation_id,collation_count,media_asset_id,video_duration_s,display_name,display_page_id,is_partnership";

export interface LaunchesPayload {
  ok: true;
  generatedAt: string;
  windowDays: number;
  /** When the scrape first saw each brand's ads: launch days before it hold only the ads that were still around. */
  brands: { name: string; trackedSince: string | null; ended: number }[];
  /** Rows of competitor_ads launched in the window, live and stopped; the client builds the ad views. */
  rows: (CompetitorAdRow & { brand: string })[];
}

/**
 * Every ad each tracked brand launched in the last `windowDays` days, stopped
 * ones included (the main payload carries live ads only). Lazy: the tab asks
 * for it when the Creative tests view opens.
 */
export async function readLaunches(windowDays: number): Promise<LaunchesPayload> {
  const now = new Date().toISOString();
  const from = addDays(now.slice(0, 10), -(windowDays - 1));
  const brandRows = await spGet<{ page_id: string; brand_name: string | null }[]>("competitor_brands?select=page_id,brand_name&active=eq.true&order=brand_name");
  if (!brandRows.length) return { ok: true, generatedAt: now, windowDays, brands: [], rows: [] };
  const inPages = `page_id=in.(${brandRows.map((b) => b.page_id).join(",")})`;
  const nameOfPage = new Map(brandRows.map((b) => [b.page_id, brandName(b.brand_name)]));

  const [rows, firstSeen] = await Promise.all([
    sbAll<Omit<CompetitorAdRow, "first_seen_at" | "eu_total_reach" | "impressions_rank" | "rank_prev" | "rank_peak" | "rank_bucket" | "ranked_at">>(
      "internal",
      `competitor_ads?select=${LAUNCH_COLS}&started_at=gte.${from}&${inPages}&order=id`,
    ),
    Promise.all(
      brandRows.map((b) =>
        spGet<{ first_seen_at: string | null }[]>(`competitor_ads?select=first_seen_at&page_id=eq.${b.page_id}&first_seen_at=not.is.null&order=first_seen_at&limit=1`).then(
          (r) => [b.page_id, r[0]?.first_seen_at ?? null] as const,
        ),
      ),
    ),
  ]);

  const out = rows.map((r) => ({
    ...r,
    // Long copy is cut; the drawer links the Ad Library for the rest.
    body: r.body && r.body.length > 400 ? `${r.body.slice(0, 400)}…` : r.body,
    first_seen_at: null,
    eu_total_reach: null,
    impressions_rank: null,
    rank_prev: null,
    rank_peak: null,
    rank_bucket: null,
    ranked_at: null,
    brand: nameOfPage.get(r.page_id) ?? "Unknown",
  }));
  const names = [...new Set(brandRows.map((b) => nameOfPage.get(b.page_id)!))];
  const brands = names.map((name) => {
    const seen = firstSeen.filter(([p]) => nameOfPage.get(p) === name).map(([, s]) => s).filter((s): s is string => !!s).sort();
    return { name, trackedSince: seen[0] ?? null, ended: out.filter((r) => r.brand === name && !r.is_active).length };
  });
  return { ok: true, generatedAt: now, windowDays, brands, rows: out };
}

// ---------------------------------------------------------------- ad detail

export interface AdDetail {
  ok: true;
  adArchiveId: string;
  archive: {
    source: string;
    pulledOn: string;
    transcript: string | null;
    timed: { start: number; end: number; text: string }[] | null;
    productMentionS: number | null;
    archiveRank: number | null;
    archiveRankPrev: number | null;
  } | null;
  storyboard: {
    hookSummary: string | null;
    transcript: string | null;
    style: string | null;
    whyItWorks: string | null;
    beats: { start: number; end: number; onScreen: string | null; audio: string | null; action: string | null }[];
  } | null;
  ranks: { day: string; rank: number }[];
}

export async function getAdDetail(adArchiveId: string): Promise<AdDetail> {
  if (!/^\d{5,25}$/.test(adArchiveId)) throw new Error("bad ad id");
  const [adRows, ranks] = await Promise.all([
    spGet<{ id: string; page_id: string }[]>(`competitor_ads?select=id,page_id&ad_archive_id=eq.${adArchiveId}&limit=1`),
    spGet<{ day: string; rank: number }[]>(`competitor_ad_ranks?select=day,rank&source=eq.outlier&ad_archive_id=eq.${adArchiveId}&order=day&limit=120`),
  ]);

  let archive: AdDetail["archive"] = null;
  try {
    const rows = await spGet<{ source: string; pulled_on: string; transcript: string | null; timed_transcript: { start: number; end: number; text: string }[] | null; product_mention_s: number | null; archive_rank: number | null; archive_rank_prev: number | null }[]>(
      `competitor_archive_ads?select=source,pulled_on,transcript,timed_transcript,product_mention_s,archive_rank,archive_rank_prev&ad_archive_id=eq.${adArchiveId}`,
    );
    const r = rows[0];
    if (r) archive = { source: r.source, pulledOn: r.pulled_on, transcript: r.transcript, timed: r.timed_transcript, productMentionS: r.product_mention_s, archiveRank: r.archive_rank, archiveRankPrev: r.archive_rank_prev };
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    const r = localArchive()?.full.find((x) => x.ad_archive_id === adArchiveId);
    if (r) archive = { source: r.source, pulledOn: r.pulled_on, transcript: r.transcript, timed: r.timed_transcript, productMentionS: r.product_mention_s, archiveRank: r.archive_rank, archiveRankPrev: r.archive_rank_prev };
  }

  let storyboard: AdDetail["storyboard"] = null;
  const id = adRows[0]?.id;
  if (id) {
    const va = await spGet<{ hook_summary: string | null; transcript: string | null; style: string | null; why_it_works: string | null; beats: Record<string, unknown>[] | null }[]>(
      `video_analyses?select=hook_summary,transcript,style,why_it_works,beats&source_kind=eq.competitor&source_id=eq.${id}&order=created_at.desc&limit=1`,
    );
    const v = va[0];
    if (v) {
      const s = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
      storyboard = {
        hookSummary: v.hook_summary,
        transcript: v.transcript,
        style: v.style,
        whyItWorks: v.why_it_works,
        beats: (v.beats ?? []).map((b) => ({
          start: Number(b.t_start ?? 0),
          end: Number(b.t_end ?? 0),
          onScreen: s(b.on_screen_text),
          audio: s(b.audio),
          action: s(b.subject_action),
        })),
      };
    }
  }
  return { ok: true, adArchiveId, archive, storyboard, ranks };
}

// ---------------------------------------------------------------- writes

export type Pick = "brief" | "maybe" | "skip" | null;

export async function setHookPick(id: string, pick: Pick): Promise<{ stored: Source }> {
  try {
    const rows = await spPatch<unknown[]>(`competitor_hooks?id=eq.${encodeURIComponent(id)}`, { pick, pick_at: pick ? new Date().toISOString() : null });
    if (Array.isArray(rows) && !rows.length) throw new Error("hook not found");
    return { stored: "table" };
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    if (!DEV) throw new Error("the competitor_hooks table doesn't exist yet (migration 0122)");
    memory.picks.set(id, pick);
    return { stored: "local" };
  }
}

export async function saveAd(adArchiveId: string, pageId: string, note: string, by: string): Promise<{ stored: Source }> {
  const row = { ad_archive_id: adArchiveId, page_id: pageId, note: note.slice(0, 2000), saved_by: by.slice(0, 80) };
  try {
    await spPost("competitor_ad_saves", [row], { onConflict: "ad_archive_id", resolution: "merge" });
    return { stored: "table" };
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    if (!DEV) throw new Error("the competitor_ad_saves table doesn't exist yet (migration 0122)");
    memory.saves.set(adArchiveId, { ad_archive_id: adArchiveId, page_id: pageId, note: row.note, saved_at: memory.saves.get(adArchiveId)?.saved_at ?? new Date().toISOString() });
    return { stored: "local" };
  }
}

export async function unsaveAd(adArchiveId: string): Promise<{ stored: Source }> {
  try {
    await spDelete(`competitor_ad_saves?ad_archive_id=eq.${encodeURIComponent(adArchiveId)}`);
    return { stored: "table" };
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    if (!DEV) throw new Error("the competitor_ad_saves table doesn't exist yet (migration 0122)");
    memory.saves.delete(adArchiveId);
    return { stored: "local" };
  }
}
