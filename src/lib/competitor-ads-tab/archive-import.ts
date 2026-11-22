/**
 * Pure parsers for the outside competitor archive (Foreplay pulls kept in the
 * vault) and the ranked hook CSV. Used by scripts/import-competitor-archive.ts
 * to fill competitor_archive_ads / competitor_hooks, and in development by the
 * tab's reader when those tables are missing.
 *
 * Files understood (by name):
 *   <brand>_ads_p<N>.json                 Foreplay archive pages: { data: Ad[] }
 *   <brand>_spyder_rankings_<date>*.json  Spyder ranking pages: { data: { ads: Ad[] } }
 * Ad ids are Meta's ad_archive_id. Spyder sends them as bare JSON numbers,
 * so they are quoted before parsing (some ids pass 2^53).
 *
 * Media URLs in these files point at Foreplay's own storage and are never kept.
 */

export interface ArchiveRow {
  ad_archive_id: string;
  page_id: string;
  brand: string;
  /** "foreplay" = from the archive pages; "foreplay_spyder" = only in a ranking list (live ads only, so kept out of survival). */
  source: "foreplay" | "foreplay_spyder";
  pulled_on: string;
  started_at: string | null;
  running_days: number | null;
  live_at_pull: boolean | null;
  display_format: string | null;
  identity: string | null;
  headline: string | null;
  description: string | null;
  link_url: string | null;
  video_duration_s: number | null;
  transcript: string | null;
  timed_transcript: { start: number; end: number; text: string }[] | null;
  product_mention_s: number | null;
  archive_rank: number | null;
  archive_rank_prev: number | null;
}

export interface HookRow {
  id: string;
  position: number;
  tier: string | null;
  score: number | null;
  brand: string;
  hook: string;
  hook_type: string | null;
  visual: string | null;
  style: string | null;
  identity: string | null;
  max_days: number | null;
  ads: number | null;
  live: number | null;
  video_s: number | null;
  first_start: string | null;
  ad_archive_id: string | null;
  source_file: string;
}

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const isoFromMs = (v: unknown): string | null => {
  const n = num(v);
  return n == null ? null : new Date(n).toISOString();
};

/** JSON.parse with every "ad_id": 123 turned into a string first. */
export function parseWithTextIds(text: string): unknown {
  return JSON.parse(text.replace(/"ad_id"\s*:\s*(\d+)/g, '"ad_id":"$1"'));
}

function timed(v: unknown): ArchiveRow["timed_transcript"] {
  if (!Array.isArray(v) || !v.length) return null;
  const out = v
    .map((s: Json) => ({ start: num(s?.startTime) ?? 0, end: num(s?.endTime) ?? 0, text: (str(s?.sentence) ?? "").trim() }))
    .filter((s) => s.text);
  return out.length ? out : null;
}

function blank(id: string, brand: string, pageId: string, pulledOn: string, source: ArchiveRow["source"]): ArchiveRow {
  return {
    ad_archive_id: id, page_id: pageId, brand, source, pulled_on: pulledOn,
    started_at: null, running_days: null, live_at_pull: null, display_format: null, identity: null,
    headline: null, description: null, link_url: null, video_duration_s: null, transcript: null,
    timed_transcript: null, product_mention_s: null, archive_rank: null, archive_rank_prev: null,
  };
}

/** Fill only fields that are still empty, so the archive page wins over Spyder for shared fields. */
function fill(row: ArchiveRow, patch: Partial<ArchiveRow>) {
  for (const [k, v] of Object.entries(patch) as [keyof ArchiveRow, unknown][]) {
    if (v == null) continue;
    if (row[k] == null) (row as unknown as Record<string, unknown>)[k] = v;
  }
}

/**
 * Turn a set of archive files into one row per ad. `pages` maps the brand
 * prefix in the file name ("meagain") to its Ad Library page id.
 */
export function parseArchiveFiles(
  files: { name: string; text: string }[],
  pages: Record<string, string>,
  pulledOn: string,
): { rows: ArchiveRow[]; skipped: string[] } {
  const rows = new Map<string, ArchiveRow>();
  const skipped: string[] = [];
  const get = (id: string, brand: string, source: ArchiveRow["source"]) => {
    if (!rows.has(id)) rows.set(id, blank(id, brand, pages[brand], pulledOn, source));
    return rows.get(id)!;
  };

  // Archive pages first (they carry run length and the full transcript).
  const ordered = [...files].sort((a, b) => Number(/_spyder_/.test(a.name)) - Number(/_spyder_/.test(b.name)));
  for (const f of ordered) {
    const m = /^([a-z0-9]+)_(ads_p\d+|spyder_rankings_[\w-]+)\.json$/i.exec(f.name);
    const brand = m?.[1]?.toLowerCase();
    if (!m || !brand || !pages[brand]) {
      skipped.push(f.name);
      continue;
    }
    const parsed = parseWithTextIds(f.text) as Json;
    const data = parsed?.data as Json | Json[] | undefined;
    const ads = (Array.isArray(data) ? data : ((data?.ads as Json[]) ?? [])) as Json[];
    const spyder = m[2].startsWith("spyder");
    for (const a of ads) {
      const id = str(a.ad_id);
      if (!id || !/^\d+$/.test(id)) continue;
      const row = get(id, brand, spyder ? "foreplay_spyder" : "foreplay");
      if (!spyder) {
        const dur = (a.running_duration as Json | undefined)?.days;
        fill(row, {
          started_at: isoFromMs(a.started_running),
          running_days: num(dur),
          live_at_pull: typeof a.live === "boolean" ? a.live : null,
          display_format: str(a.display_format),
          identity: str(a.name),
          headline: str(a.headline),
          description: str(a.description),
          link_url: str(a.link_url),
          video_duration_s: num(a.video_duration),
          transcript: str(a.full_transcription),
        });
      } else {
        const r = (a.ranking ?? {}) as Json;
        const mention = num(a.timeProductWasMentioned);
        const tt = timed(a.timestampedTranscription);
        fill(row, {
          started_at: isoFromMs(a.startedRunning),
          running_days: num(r.days_running),
          live_at_pull: typeof a.live === "boolean" ? a.live : null,
          display_format: str(a.display_format),
          identity: str(a.name),
          headline: str(a.headline),
          description: str(a.description),
          link_url: str(a.link_url),
          video_duration_s: num(a.video_duration),
          timed_transcript: tt,
          transcript: tt ? tt.map((s) => s.text).join(" ") : null,
          product_mention_s: mention != null && mention >= 0 ? mention : null,
        });
        // Rank fields always come from the ranking file.
        row.archive_rank = num(r.rank);
        row.archive_rank_prev = num(r.previous_rank);
        if (tt) row.timed_transcript = tt;
        if (mention != null && mention >= 0) row.product_mention_s = mention;
      }
    }
  }
  return { rows: [...rows.values()], skipped };
}

/** Minimal RFC-4180 CSV reader (quoted fields, doubled quotes, BOM). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x !== "")) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) out.push(row);
  return out;
}

/** Stable id for a hook, so a re-ranked file keeps the picks already made. */
export function hookId(brand: string, hook: string): string {
  const slug = hook.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return `${brand.toLowerCase()}:${slug}`;
}

/**
 * The ranked hook CSV. `foreplayToAd` maps a Foreplay ad id (the `?ad=` in
 * the url column) to Meta's ad_archive_id, from the archive pages.
 */
export function parseHooksCsv(text: string, sourceFile: string, foreplayToAd: Map<string, string>): HookRow[] {
  const [head, ...lines] = parseCsv(text);
  const col = (name: string) => head.indexOf(name);
  const at = (r: string[], name: string) => (col(name) >= 0 ? r[col(name)] ?? "" : "");
  const seen = new Set<string>();
  const out: HookRow[] = [];
  for (const r of lines) {
    const brand = at(r, "brand").trim().toLowerCase();
    const hook = at(r, "hook").replace(/\s*\/\s*/g, " / ").trim();
    if (!brand || !hook) continue;
    let id = hookId(brand, hook);
    while (seen.has(id)) id += "-2";
    seen.add(id);
    const fpId = /[?&]ad=([A-Za-z0-9]+)/.exec(at(r, "url"))?.[1] ?? "";
    out.push({
      id,
      position: num(at(r, "rank")) ?? out.length + 1,
      tier: str(at(r, "tier")),
      score: num(at(r, "score")),
      brand,
      hook,
      hook_type: str(at(r, "hook_type")),
      visual: str(at(r, "visual")),
      style: str(at(r, "style")),
      identity: str(at(r, "identity")),
      max_days: num(at(r, "max_days")),
      ads: num(at(r, "ads")),
      live: num(at(r, "live")),
      video_s: num(at(r, "video_s")),
      first_start: /^\d{4}-\d{2}-\d{2}$/.test(at(r, "first_start")) ? at(r, "first_start") : null,
      ad_archive_id: foreplayToAd.get(fpId) ?? null,
      source_file: sourceFile,
    });
  }
  return out;
}

/** Foreplay ad id -> Meta ad_archive_id, read from archive pages. */
export function foreplayIdMap(files: { name: string; text: string }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of files) {
    if (!/_ads_p\d+\.json$/i.test(f.name)) continue;
    const parsed = parseWithTextIds(f.text) as { data?: Json[] };
    for (const a of parsed.data ?? []) {
      const fp = str(a.id);
      const id = str(a.ad_id);
      if (fp && id) m.set(fp, id);
    }
  }
  return m;
}
