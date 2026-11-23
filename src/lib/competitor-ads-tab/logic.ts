/**
 * Competitor ads tab: pure rules, shared by the server reader (read.ts) and
 * the client tab. No I/O, no server imports.
 *
 * Ranking method (vault: glp1-app-competitors-foreplay, "How to find a
 * competitor's top ads"): rank by Meta's own delivery first (the Ad Library's
 * impressions order, snapshotted daily by Outlier into competitor_ad_ranks),
 * then check it against other signals. Confidence = how many of the signals
 * that exist for an ad agree.
 */

export const DAY_MS = 86_400_000;

export const dayOf = (iso: string) => iso.slice(0, 10);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${dayOf(b)}T00:00:00Z`) - Date.parse(`${dayOf(a)}T00:00:00Z`)) / DAY_MS);

// ---------------------------------------------------------------- rows

/** The columns of competitor_ads the tab reads. */
export interface CompetitorAdRow {
  id: string;
  ad_archive_id: string;
  page_id: string;
  page_name: string | null;
  is_active: boolean;
  started_at: string | null;
  ended_at: string | null;
  first_seen_at: string | null;
  media_type: string | null;
  format: string | null;
  thumbnail_url: string | null;
  video_archive_url: string | null;
  title: string | null;
  body: string | null;
  hook: string | null;
  angle: string | null;
  messaging_theme: string | null;
  cta_text: string | null;
  link_url: string | null;
  ad_library_url: string | null;
  collation_id: string | null;
  collation_count: number | null;
  media_asset_id: string | null;
  video_duration_s: number | null;
  eu_total_reach: number | null;
  display_name: string | null;
  is_partnership: boolean | null;
  impressions_rank: number | null;
  rank_prev: number | null;
  rank_peak: number | null;
  rank_bucket: string | null;
  ranked_at: string | null;
}

export interface RankRow {
  page_id: string;
  day: string;
  ad_archive_id: string;
  rank: number;
}

// ---------------------------------------------------------------- landing

export interface Landing {
  kind: "app_store" | "play" | "web" | "none";
  appId: string | null;
  cpp: string | null;
}

/** Where an ad's click goes: App Store (with its Custom Product Page id), Play, the web, or no link captured. */
export function parseLanding(link: string | null | undefined): Landing {
  if (!link) return { kind: "none", appId: null, cpp: null };
  let decoded = link;
  try {
    decoded = decodeURIComponent(link);
  } catch {
    /* keep raw */
  }
  const cpp = /[?&](?:af_ios_store_cpp|ppid)=([0-9a-f-]{8,})/i.exec(decoded)?.[1]?.toLowerCase() ?? null;
  let host = "";
  let pathname = "";
  try {
    const u = new URL(decoded);
    host = u.hostname.toLowerCase();
    pathname = u.pathname;
  } catch {
    return { kind: "web", appId: null, cpp };
  }
  const androidPackagePath = /^\/[a-z][\w]*(\.[\w]+)+\/?$/i.test(pathname);
  if (
    host.includes("play.google.") ||
    ((host.includes("appsflyer") || host.includes("onelink")) && androidPackagePath) ||
    (/[?&]id=[a-z]+\.[a-z0-9._]+/i.test(decoded) && !/\/id\d+/.test(pathname))
  ) {
    return { kind: "play", appId: null, cpp: null };
  }
  const appId = /\/id(\d{6,})/.exec(pathname)?.[1] ?? null;
  if (host.includes("apps.apple.com") || host.includes("itunes.apple.com") || (host.includes("appsflyer") && appId) || (host.includes("onelink") && appId)) {
    return { kind: "app_store", appId, cpp };
  }
  return { kind: "web", appId, cpp };
}

/** Public link to a Custom Product Page. */
export const cppUrl = (appId: string, cpp: string) => `https://apps.apple.com/us/app/id${appId}?ppid=${cpp}`;

// ---------------------------------------------------------------- rank history

export interface RankStats {
  /** Rank on the newest snapshot day (null when not ranked then). */
  now: number | null;
  /** Rank 7 and 14 days before the newest day (nearest earlier snapshot within 2 days). */
  ago7: number | null;
  ago14: number | null;
  /** Days ranked in the top 20 / top 50 within the last 14 snapshot days. */
  top20: number;
  top50: number;
  /** Snapshot days the brand had in that window (the denominator). */
  observed: number;
  /** Best rank on any snapshot day in the window. */
  best: number | null;
}

export interface BrandRankIndex {
  latestDay: string | null;
  /** Distinct snapshot days for the brand within the window. */
  days: string[];
  byAd: Map<string, Map<string, number>>;
}

/** Index one brand's rank snapshots (source "outlier" only: earlier seeded rows are subset re-ranks, not positions). */
export function indexRanks(rows: RankRow[], windowDays = 14): BrandRankIndex {
  const allDays = [...new Set(rows.map((r) => r.day))].sort();
  const latestDay = allDays.at(-1) ?? null;
  const from = latestDay ? addDays(latestDay, -(windowDays - 1)) : null;
  const byAd = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!byAd.has(r.ad_archive_id)) byAd.set(r.ad_archive_id, new Map());
    byAd.get(r.ad_archive_id)!.set(r.day, r.rank);
  }
  return { latestDay, days: from ? allDays.filter((d) => d >= from) : [], byAd };
}

function rankNear(hist: Map<string, number> | undefined, day: string, slack = 2): number | null {
  if (!hist) return null;
  for (let k = 0; k <= slack; k++) {
    const v = hist.get(addDays(day, -k));
    if (v != null) return v;
  }
  return null;
}

export function rankStats(idx: BrandRankIndex, adArchiveId: string): RankStats {
  const hist = idx.byAd.get(adArchiveId);
  if (!idx.latestDay) return { now: null, ago7: null, ago14: null, top20: 0, top50: 0, observed: 0, best: null };
  let top20 = 0;
  let top50 = 0;
  let best: number | null = null;
  for (const d of idx.days) {
    const r = hist?.get(d);
    if (r == null) continue;
    if (r <= 20) top20++;
    if (r <= 50) top50++;
    best = best == null ? r : Math.min(best, r);
  }
  // The 7/14-day lookback must land on a snapshot day before the newest one.
  const ago = (n: number) => {
    const target = addDays(idx.latestDay!, -n);
    return rankNear(hist, target);
  };
  return {
    now: hist?.get(idx.latestDay) ?? null,
    ago7: ago(7),
    ago14: ago(14),
    top20,
    top50,
    observed: idx.days.length,
    best,
  };
}

// ---------------------------------------------------------------- per-ad view

export type Bucket = "breakout" | "evergreen" | "riser" | "steady";

export interface AdView {
  id: string;
  adArchiveId: string;
  pageId: string;
  brand: string;
  identity: string;
  isPartnership: boolean;
  startedAt: string | null;
  /** Meta's end date for an ad that has stopped; null while it runs. */
  endedAt: string | null;
  /** Days from start to now, or to the end date once the ad has stopped. */
  runDays: number | null;
  mediaType: "video" | "dco" | "image" | "none";
  format: string | null;
  thumb: string | null;
  video: string | null;
  videoSeconds: number | null;
  title: string | null;
  body: string | null;
  hook: string | null;
  angle: string | null;
  theme: string | null;
  cta: string | null;
  adLibraryUrl: string;
  landing: Landing;
  euReach: number | null;
  rank: RankStats;
  /** Outlier's stored labels, kept as they are. */
  storedBucket: "breakout" | "evergreen" | null;
  rankPeak: number | null;
  /** Live ads of this brand using the same creative (video file, Meta asset id or collation). */
  copies: number;
  creativeKey: string | null;
  confidence: { met: number; of: number; signals: { key: string; label: string; met: boolean }[] };
  buckets: Bucket[];
}

export function mediaKind(t: string | null | undefined): AdView["mediaType"] {
  const v = (t ?? "").toLowerCase();
  if (v === "video") return "video";
  if (v === "dco") return "dco";
  if (v === "image") return "image";
  return "none";
}

export function creativeKey(a: Pick<CompetitorAdRow, "media_asset_id" | "video_archive_url" | "collation_id">): string | null {
  if (a.media_asset_id) return `asset:${a.media_asset_id}`;
  if (a.video_archive_url) {
    // One archive file per Meta video asset: competitor-ads/videos/<asset id>.mp4
    const m = /\/videos\/([^/?#]+)\.mp4/i.exec(a.video_archive_url);
    return m ? `asset:${m[1]}` : `file:${a.video_archive_url}`;
  }
  if (a.collation_id) return `collation:${a.collation_id}`;
  return null;
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[i];
}

/** Thresholds behind the confidence signals, shown in the tab's explainer. */
export const SIGNALS = {
  topRank: 20,
  persistDays: 7,
  persistMinObserved: 7,
  longRunDays: 21,
  copies: 3,
  euMinSample: 4,
} as const;

/**
 * Build the per-ad view for one brand's live ads. `now` is the reading time
 * (ISO), `rankFresh` false when the brand's newest snapshot is older than 48 h
 * (then no rank is shown: a failed scrape must not read as "#3 today").
 */
export function buildAdViews(
  rows: CompetitorAdRow[],
  brand: string,
  idx: BrandRankIndex,
  nowIso: string,
  rankFresh: boolean,
): AdView[] {
  const groups = new Map<string, number>();
  for (const r of rows) {
    const k = creativeKey(r);
    if (k) groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  const eu = rows.map((r) => r.eu_total_reach).filter((v): v is number => v != null && v > 0).sort((a, b) => a - b);
  const euP75 = eu.length >= SIGNALS.euMinSample ? quantile(eu, 0.75) : null;

  return rows.map((r) => {
    const stats = rankFresh ? rankStats(idx, r.ad_archive_id) : { now: null, ago7: null, ago14: null, top20: 0, top50: 0, observed: 0, best: null };
    const key = creativeKey(r);
    const copies = Math.max(key ? groups.get(key) ?? 1 : 1, r.collation_count ?? 1);
    const endedAt = r.is_active ? null : r.ended_at;
    const runDays = r.started_at ? Math.max(0, daysBetween(r.started_at, endedAt ?? nowIso)) : null;

    const signals: AdView["confidence"]["signals"] = [];
    if (stats.now != null) signals.push({ key: "rank", label: `Top ${SIGNALS.topRank} by delivery today`, met: stats.now <= SIGNALS.topRank });
    if (stats.observed >= SIGNALS.persistMinObserved) {
      signals.push({ key: "persist", label: `Top ${SIGNALS.topRank} on ${SIGNALS.persistDays}+ of the last ${stats.observed} days`, met: stats.top20 >= SIGNALS.persistDays });
    }
    if (runDays != null) signals.push({ key: "run", label: `Live ${SIGNALS.longRunDays}+ days`, met: runDays >= SIGNALS.longRunDays });
    if (key || r.collation_count != null) signals.push({ key: "copies", label: `${SIGNALS.copies}+ live copies of the creative`, met: copies >= SIGNALS.copies });
    if (euP75 != null && r.eu_total_reach != null) {
      signals.push({ key: "eu", label: "EU reach in the brand's top quarter", met: r.eu_total_reach >= euP75 });
    }

    const stored = r.rank_bucket === "breakout" || r.rank_bucket === "evergreen" ? r.rank_bucket : null;
    const buckets: Bucket[] = [];
    if (rankFresh && stored) buckets.push(stored);
    if (isRiser(stats) && stored !== "breakout") buckets.push("riser");
    if (isSteady(stats, runDays) && stored !== "evergreen") buckets.push("steady");

    return {
      id: r.id,
      adArchiveId: r.ad_archive_id,
      pageId: r.page_id,
      brand,
      identity: r.display_name || r.page_name || brand,
      // Outlier's is_partnership flag misses most creator ads, so an ad that
      // runs under any account other than the brand's own page counts too.
      isPartnership: !!r.is_partnership || (!!r.display_name && !!r.page_name && r.display_name !== r.page_name),
      startedAt: r.started_at,
      endedAt,
      runDays,
      mediaType: mediaKind(r.media_type),
      format: r.format,
      thumb: r.thumbnail_url,
      video: r.video_archive_url,
      videoSeconds: r.video_duration_s,
      title: r.title,
      body: r.body,
      hook: r.hook,
      angle: r.angle,
      theme: r.messaging_theme,
      cta: r.cta_text,
      adLibraryUrl: r.ad_library_url || `https://www.facebook.com/ads/library/?id=${r.ad_archive_id}`,
      landing: parseLanding(r.link_url),
      euReach: r.eu_total_reach,
      rank: stats,
      storedBucket: rankFresh ? stored : null,
      rankPeak: r.rank_peak,
      copies,
      creativeKey: key,
      confidence: { met: signals.filter((s) => s.met).length, of: signals.length, signals },
      buckets,
    };
  });
}

/** Fast riser: in the top 50 now and at least 20 places higher than a week ago (or new in that week). */
export function isRiser(s: RankStats): boolean {
  if (s.now == null || s.now > 50) return false;
  if (s.ago7 == null) return false;
  return s.ago7 - s.now >= 20;
}

/** Steady long-runner: live 30+ days and in the top 50 on at least 80% of the snapshot days (10+ days observed). */
export function isSteady(s: RankStats, runDays: number | null): boolean {
  if (runDays == null || runDays < 30 || s.observed < 10 || s.now == null) return false;
  return s.top50 >= Math.ceil(s.observed * 0.8);
}

// ---------------------------------------------------------------- identities

export interface IdentityView {
  brand: string;
  identity: string;
  isPartnership: boolean;
  live: number;
  top20: number;
  bestRank: number | null;
  firstSeen: string | null;
  adsSeen: number;
}

/**
 * Roll ads up by the account they run as. `all` is every ad seen (Outlier rows,
 * then archive rows carrying an identity); an ad id counts once, and the first
 * row with a name wins, so pass Outlier's rows first.
 */
export function buildIdentities(
  live: AdView[],
  all: { page_id: string; display_name: string | null; started_at: string | null; ad_archive_id?: string | null }[],
  brandOfPage: (pageId: string) => string,
): IdentityView[] {
  const key = (b: string, i: string) => `${b}\u0000${i}`;
  const out = new Map<string, IdentityView>();
  const counted = new Set<string>();
  for (const a of all) {
    if (!a.display_name) continue;
    if (a.ad_archive_id) {
      if (counted.has(a.ad_archive_id)) continue;
      counted.add(a.ad_archive_id);
    }
    const b = brandOfPage(a.page_id);
    const k = key(b, a.display_name);
    const v = out.get(k) ?? { brand: b, identity: a.display_name, isPartnership: false, live: 0, top20: 0, bestRank: null, firstSeen: null, adsSeen: 0 };
    v.adsSeen++;
    if (a.started_at && (!v.firstSeen || a.started_at < v.firstSeen)) v.firstSeen = a.started_at;
    out.set(k, v);
  }
  for (const a of live) {
    const k = key(a.brand, a.identity);
    const v = out.get(k) ?? { brand: a.brand, identity: a.identity, isPartnership: false, live: 0, top20: 0, bestRank: null, firstSeen: a.startedAt, adsSeen: 1 };
    v.live++;
    v.isPartnership = v.isPartnership || a.isPartnership;
    if (a.rank.now != null) {
      if (a.rank.now <= 20) v.top20++;
      v.bestRank = v.bestRank == null ? a.rank.now : Math.min(v.bestRank, a.rank.now);
    }
    out.set(k, v);
  }
  return [...out.values()].filter((v) => v.live > 0).sort((a, b) => a.brand.localeCompare(b.brand) || b.live - a.live);
}

// ---------------------------------------------------------------- custom product pages

export interface CppView {
  brand: string;
  appId: string | null;
  cpp: string;
  url: string | null;
  live: number;
  top20: number;
  bestRank: number | null;
  firstStarted: string | null;
  sampleHooks: string[];
}

export interface LandingMix {
  brand: string;
  live: number;
  appStoreDefault: number;
  appStoreCpp: number;
  play: number;
  web: number;
  none: number;
}

export function buildCpps(live: AdView[]): { pages: CppView[]; mix: LandingMix[] } {
  const pages = new Map<string, CppView & { _hooks: Map<string, number> }>();
  const mix = new Map<string, LandingMix>();
  for (const a of live) {
    const m = mix.get(a.brand) ?? { brand: a.brand, live: 0, appStoreDefault: 0, appStoreCpp: 0, play: 0, web: 0, none: 0 };
    m.live++;
    const l = a.landing;
    if (l.kind === "app_store") l.cpp ? m.appStoreCpp++ : m.appStoreDefault++;
    else if (l.kind === "play") m.play++;
    else if (l.kind === "web") m.web++;
    else m.none++;
    mix.set(a.brand, m);
    if (!l.cpp) continue;
    const k = `${a.brand}\u0000${l.cpp}`;
    const v = pages.get(k) ?? { brand: a.brand, appId: l.appId, cpp: l.cpp, url: null, live: 0, top20: 0, bestRank: null, firstStarted: null, sampleHooks: [], _hooks: new Map() };
    v.live++;
    v.appId = v.appId ?? l.appId;
    if (a.rank.now != null) {
      if (a.rank.now <= 20) v.top20++;
      v.bestRank = v.bestRank == null ? a.rank.now : Math.min(v.bestRank, a.rank.now);
    }
    if (a.startedAt && (!v.firstStarted || a.startedAt < v.firstStarted)) v.firstStarted = a.startedAt;
    const h = (a.hook || a.title || "").trim();
    if (h) v._hooks.set(h, Math.min(v._hooks.get(h) ?? Infinity, a.rank.now ?? 9999));
    pages.set(k, v);
  }
  return {
    pages: [...pages.values()]
      .map(({ _hooks, ...v }) => ({
        ...v,
        url: v.appId ? cppUrl(v.appId, v.cpp) : null,
        sampleHooks: [..._hooks].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([h]) => h),
      }))
      .sort((a, b) => a.brand.localeCompare(b.brand) || b.live - a.live),
    mix: [...mix.values()],
  };
}

// ---------------------------------------------------------------- format mix

export interface FormatMix {
  video: number;
  dco: number;
  image: number;
  /** Live ads whose creative wasn't captured yet (new ads often show none for a day). */
  none: number;
}

export function formatMix(live: AdView[]): FormatMix {
  const m: FormatMix = { video: 0, dco: 0, image: 0, none: 0 };
  for (const a of live) m[a.mediaType]++;
  return m;
}

// ---------------------------------------------------------------- archive: launches and survival

export interface ArchiveAd {
  ad_archive_id: string;
  page_id: string;
  brand: string;
  source: string;
  pulled_on: string;
  started_at: string | null;
  running_days: number | null;
  live_at_pull: boolean | null;
  headline: string | null;
  description: string | null;
  transcript?: string | null;
  /** The account the ad ran as (Foreplay's partner name), when the pull had one. */
  identity?: string | null;
}

export interface LaunchMonth {
  month: string;
  launched: number;
  /** Share still running N days after launch; null while the month is too new to tell. */
  lasted7: number | null;
  lasted14: number | null;
  lasted30: number | null;
  /** Cohort sizes behind each share (ads launched at least N days before the pull). */
  n7: number;
  n14: number;
  n30: number;
  liveAtPull: number;
}

/**
 * Ads launched per month and the share that lasted 7, 14 and 30 days.
 * Only ads launched at least N days before the pull count towards "lasted N",
 * so a young month never reads as a die-off.
 */
export function launchMonths(ads: ArchiveAd[]): LaunchMonth[] {
  const by = new Map<string, ArchiveAd[]>();
  for (const a of ads) {
    if (!a.started_at || a.source !== "foreplay") continue;
    const m = a.started_at.slice(0, 7);
    if (!by.has(m)) by.set(m, []);
    by.get(m)!.push(a);
  }
  return [...by]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, list]) => {
      const share = (n: number) => {
        const old = list.filter((a) => daysBetween(a.started_at!, a.pulled_on) >= n);
        const lasted = old.filter((a) => (a.running_days ?? 0) >= n).length;
        return { n: old.length, share: old.length >= 5 ? lasted / old.length : null };
      };
      const s7 = share(7);
      const s14 = share(14);
      const s30 = share(30);
      return {
        month,
        launched: list.length,
        lasted7: s7.share,
        lasted14: s14.share,
        lasted30: s30.share,
        n7: s7.n,
        n14: s14.n,
        n30: s30.n,
        liveAtPull: list.filter((a) => a.live_at_pull).length,
      };
    });
}

/** Topic keyword sets, matched on the headline, the ad copy and the opening of the transcript (vault topic table). */
export const TOPICS: { key: string; label: string; re: RegExp }[] = [
  { key: "fiber", label: "Constipation, fiber", re: /constipat|fib(er|re)|bloat|poop|bowel/i },
  { key: "progress", label: "Progress, weight chart", re: /progress|weight (chart|trend|graph)|lbs? (down|lost)|pounds? (down|lost)|stone|scale|before and after/i },
  { key: "mascot", label: "Mascot (pet, tamagotchi)", re: /capy|tamagotchi|mascot|\bpet\b|cute|sad (capy|pet)/i },
  { key: "start", label: "First month, starting out", re: /first (month|week|shot|dose)|week (1|one)\b|day (1|one)\b|just start|starting (my )?(glp|ozempic|wegovy|mounjaro|zepbound)|newbie|beginner/i },
  { key: "protein", label: "Protein", re: /protein/i },
  { key: "side", label: "Side effects, rough days", re: /nause|side effect|rough day|vomit|heartburn|sulfur|diarrh|food noise/i },
  { key: "shot", label: "Shot day, schedule, missed doses", re: /shot day|injection|inject|missed (dose|shot)|dose day|schedule|reminder|site rotation/i },
  { key: "plan", label: "Plan, guidance, doctor", re: /\bplan\b|guidance|guide|doctor|dietitian|pharmacist|nurse|no one told|nobody told/i },
  { key: "eat", label: "What to eat", re: /what (to|should i) eat|meal|food|snack|recipe|breakfast|lunch|dinner|grocery|restaurant/i },
  { key: "level", label: "Medication level curve", re: /level|half.?life|peak|in your system|wearing off|wears off/i },
];

export function topicsOf(a: Pick<ArchiveAd, "headline" | "description" | "transcript">): string[] {
  // The first copy line only: later lines are often a feature-list boilerplate shared by every ad.
  const text = `${a.headline ?? ""}\n${(a.description ?? "").split("\n")[0] ?? ""}\n${(a.transcript ?? "").slice(0, 160)}`;
  return TOPICS.filter((t) => t.re.test(text)).map((t) => t.key);
}

export interface TopicSurvival {
  key: string;
  label: string;
  /** Ads at least 21 days old at the pull with this topic. */
  ads: number;
  /** Share of them that ran 14+ days (null under 5 ads). */
  lasted14: number | null;
}

/** Survival by topic: of ads 21+ days old at the pull, the share that ran 14+ days. */
export function topicSurvival(ads: ArchiveAd[]): { all: TopicSurvival; topics: TopicSurvival[] } {
  const old = ads.filter((a) => a.source === "foreplay" && a.started_at && daysBetween(a.started_at, a.pulled_on) >= 21);
  const rate = (list: ArchiveAd[]) => (list.length >= 5 ? list.filter((a) => (a.running_days ?? 0) >= 14).length / list.length : null);
  const tagged = old.map((a) => ({ a, t: topicsOf(a) }));
  return {
    all: { key: "all", label: "All ads 21+ days old", ads: old.length, lasted14: rate(old) },
    topics: TOPICS.map((t) => {
      const list = tagged.filter((x) => x.t.includes(t.key)).map((x) => x.a);
      return { key: t.key, label: t.label, ads: list.length, lasted14: rate(list) };
    }).sort((a, b) => (b.lasted14 ?? -1) - (a.lasted14 ?? -1)),
  };
}

// ---------------------------------------------------------------- brief stub

const fmtRank = (n: number | null) => (n == null ? "not ranked" : `#${n}`);

/** A plain brief to start from, built only from the ad's own fields. No AI. */
export function briefFromAd(a: AdView, transcriptFirstLine?: string | null): string {
  const lines = [
    `# Brief from ${a.brand}: ${a.hook || a.title || "untitled ad"}`,
    "",
    "## Signal",
    `- ${a.brand}, runs as ${a.identity}${a.isPartnership ? " (partnership ad)" : ""}`,
    `- Delivery rank ${fmtRank(a.rank.now)} today, ${fmtRank(a.rank.ago7)} a week ago, ${fmtRank(a.rank.ago14)} two weeks ago`,
    `- Live ${a.runDays ?? "?"} days, ${a.copies} live ${a.copies === 1 ? "copy" : "copies"} of the creative, ${a.confidence.met} of ${a.confidence.of} signals agree`,
    "",
    "## Angle",
    `- ${a.angle || a.theme || "(fill in)"}`,
    "",
    "## Hook",
    `- On screen: ${a.hook || "(fill in)"}`,
    ...(transcriptFirstLine ? [`- Spoken: ${transcriptFirstLine}`] : []),
    "",
    "## Format and beats",
    `- ${a.format || a.mediaType}${a.videoSeconds ? `, ${a.videoSeconds} s` : ""}`,
    "",
    "## Our version",
    "- Copy the idea, not the ad: change 10-20% at least (near-identical copies lose the auction to the bigger spender).",
    "- (fill in what DreamMe shows, truthfully)",
    "",
    "## References",
    `- Ad Library: ${a.adLibraryUrl}`,
    ...(a.video ? [`- Video: ${a.video}`] : []),
    ...(a.landing.cpp && a.landing.appId ? [`- Their store page: ${cppUrl(a.landing.appId, a.landing.cpp)}`] : []),
    "",
    "## Success",
    "- Judged on our own cost per trial, inside the budget-test rules.",
  ];
  return lines.join("\n");
}
