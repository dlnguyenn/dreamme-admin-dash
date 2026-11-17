/**
 * App Store Connect analytics → aso_store_daily (migration 0120).
 *
 * Two reports from the ONGOING analytics report request:
 *   "App Store Discovery and Engagement Standard": impressions and product
 *     page views by source and territory;
 *   "App Downloads Standard": first-time downloads and redownloads (all users,
 *     unlike the opt-in-only Installation and Deletion report, which
 *     undercounts about 3.5x).
 * Gotchas (vault wiki/aso.md):
 *   - each DAILY instance carries two days of rows, so a day is taken from the
 *     newest instance that has it, or totals double;
 *   - Apple keeps only ~35 days of instances, so this table is the history.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";
import { spPost } from "@/lib/support/db";
import { appStoreConfigured, ascToken } from "@/lib/store-reviews";

const API = "https://api.appstoreconnect.apple.com";
/** The ONGOING analytics report request for DreamMe (created 2026-06-29). */
const REQUEST_ID = process.env.ASC_ANALYTICS_REQUEST_ID ?? "1b756963-25f5-4bf8-aecb-5c470299ec76";

export const ENGAGEMENT_REPORT = "App Store Discovery and Engagement Standard";
export const DOWNLOADS_REPORT = "App Downloads Standard";

/*
 * Credentials: the reviews key in Vercel (ASC_KEY_ID...) can't read analytics
 * (403 FORBIDDEN_ERROR, 2026-11-17), so this pull can use its own key:
 *   ASC_ANALYTICS_KEY_ID, ASC_ANALYTICS_ISSUER_ID,
 *   ASC_ANALYTICS_PRIVATE_KEY (the .p8 contents) or ASC_ANALYTICS_P8 (a path, local dev).
 * Without them it falls back to the ASC_* key.
 */
function analyticsKey(): string | null {
  if (process.env.ASC_ANALYTICS_PRIVATE_KEY) return process.env.ASC_ANALYTICS_PRIVATE_KEY.replace(/\\n/g, "\n");
  if (process.env.ASC_ANALYTICS_P8) return fs.readFileSync(process.env.ASC_ANALYTICS_P8, "utf8");
  return null;
}
const ownKey = () => !!process.env.ASC_ANALYTICS_KEY_ID && !!process.env.ASC_ANALYTICS_ISSUER_ID && !!analyticsKey();

export function ascAnalyticsConfigured(): boolean {
  return ownKey() || appStoreConfigured();
}

function analyticsToken(): string {
  if (!ownKey()) return ascToken();
  const b64url = (b: string | Buffer) => Buffer.from(b).toString("base64url");
  const header = b64url(JSON.stringify({ alg: "ES256", kid: process.env.ASC_ANALYTICS_KEY_ID, typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: process.env.ASC_ANALYTICS_ISSUER_ID, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" }));
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), { key: analyticsKey()!, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${b64url(sig)}`;
}

async function ascGet<T>(pathOrUrl: string): Promise<T> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : API + pathOrUrl;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${analyticsToken()}` }, cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`ASC ${res.status} ${pathOrUrl.slice(0, 80)}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

async function listAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = path;
  while (next) {
    const j: { data: T[]; links?: { next?: string } } = await ascGet(next);
    out.push(...(j.data ?? []));
    next = j.links?.next ?? null;
  }
  return out;
}

interface Report { id: string; attributes: { name: string; category?: string } }
interface Instance { id: string; attributes: { granularity: string; processingDate: string } }
interface Segment { id: string; attributes: { url: string } }

/** Parse Apple's tab-separated report into objects keyed by header name. */
export function parseTsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const head = lines[0].split("\t");
  return lines.slice(1).map((l) => {
    const cells = l.split("\t");
    const o: Record<string, string> = {};
    head.forEach((h, i) => (o[h] = cells[i] ?? ""));
    return o;
  });
}

export interface StoreAgg {
  impressions: number;
  impressions_unique: number;
  page_views: number;
  page_views_unique: number;
  first_downloads: number;
  redownloads: number;
}
const zero = (): StoreAgg => ({ impressions: 0, impressions_unique: 0, page_views: 0, page_views_unique: 0, first_downloads: 0, redownloads: 0 });

/** key = `${day}|${territory}|${source}` for territory in US and ALL. */
export type AggMap = Map<string, StoreAgg>;

/** Add one report's rows into an aggregate (one instance at a time). */
export function aggregateRows(rows: Record<string, string>[], kind: "engagement" | "downloads", into: AggMap = new Map()): AggMap {
  for (const r of rows) {
    const day = r["Date"];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) continue;
    const source = r["Source Type"] || "Unknown";
    const count = Number(r["Counts"]) || 0;
    const uniq = Number(r["Unique Counts"]) || 0;
    const terrs = r["Territory"] === "US" ? ["US", "ALL"] : ["ALL"];
    for (const t of terrs) {
      const key = `${day}|${t}|${source}`;
      const a = into.get(key) ?? zero();
      if (kind === "engagement") {
        if (r["Event"] === "Impression") { a.impressions += count; a.impressions_unique += uniq; }
        else if (r["Event"] === "Page view") { a.page_views += count; a.page_views_unique += uniq; }
        else continue;
      } else {
        const dt = r["Download Type"];
        if (dt === "First-time download") a.first_downloads += count;
        else if (dt === "Redownload") a.redownloads += count;
        else continue;
      }
      into.set(key, a);
    }
  }
  return into;
}

/**
 * Combine instances: for each day, keep the rows from the newest instance that
 * contains that day. `instances` = [{ processingDate, agg }] in any order.
 */
export function newestPerDay(instances: { processingDate: string; agg: AggMap }[]): Map<string, { agg: StoreAgg; instance: string }> {
  const sorted = [...instances].sort((a, b) => a.processingDate.localeCompare(b.processingDate));
  const byDay = new Map<string, { instance: string; keys: Map<string, StoreAgg> }>();
  for (const inst of sorted) {
    const days = new Map<string, Map<string, StoreAgg>>();
    for (const [k, v] of inst.agg) {
      const day = k.slice(0, 10);
      if (!days.has(day)) days.set(day, new Map());
      days.get(day)!.set(k, v);
    }
    for (const [day, keys] of days) byDay.set(day, { instance: inst.processingDate, keys }); // later instance overwrites
  }
  const out = new Map<string, { agg: StoreAgg; instance: string }>();
  for (const { instance, keys } of byDay.values()) for (const [k, v] of keys) out.set(k, { agg: v, instance });
  return out;
}

async function download(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" }); // pre-signed: no auth header
  if (!res.ok) throw new Error(`segment download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  try { return zlib.gunzipSync(buf).toString("utf8"); } catch { return buf.toString("utf8"); }
}

async function reportInstances(reportId: string, kind: "engagement" | "downloads", maxInstances: number) {
  const all = await listAll<Instance>(`/v1/analyticsReports/${reportId}/instances?filter[granularity]=DAILY&limit=200`);
  const pick = all.sort((a, b) => b.attributes.processingDate.localeCompare(a.attributes.processingDate)).slice(0, maxInstances);
  const out: { processingDate: string; agg: AggMap }[] = [];
  for (const inst of pick) {
    const segs = await listAll<Segment>(`/v1/analyticsReportInstances/${inst.id}/segments`);
    const agg: AggMap = new Map();
    for (const s of segs) aggregateRows(parseTsv(await download(s.attributes.url)), kind, agg);
    out.push({ processingDate: inst.attributes.processingDate, agg });
  }
  return { available: all.length, used: out.length, instances: out };
}

export interface AsoStoreSyncResult {
  ok: boolean;
  rows: number;
  days: string[];
  instances: Record<string, { available: number; used: number }>;
  errors: string[];
}

/**
 * Pull the newest `maxInstances` daily instances of both reports and upsert
 * them. 6 covers a missed run or two; pass 40 once to keep the whole ~35 days.
 */
export async function syncAsoStore(opts: { maxInstances?: number } = {}): Promise<AsoStoreSyncResult> {
  const maxInstances = Math.min(Math.max(opts.maxInstances ?? 6, 1), 60);
  const errors: string[] = [];
  const reports = await listAll<Report>(`/v1/analyticsReportRequests/${REQUEST_ID}/reports?limit=200`);
  const find = (name: string) => reports.find((r) => r.attributes.name === name)?.id;
  const res: AsoStoreSyncResult = { ok: false, rows: 0, days: [], instances: {}, errors };
  const syncedAt = new Date().toISOString();
  const days = new Set<string>();

  for (const [name, kind] of [[ENGAGEMENT_REPORT, "engagement"], [DOWNLOADS_REPORT, "downloads"]] as const) {
    const id = find(name);
    if (!id) { errors.push(`report "${name}" not found on request ${REQUEST_ID}`); continue; }
    try {
      const r = await reportInstances(id, kind, maxInstances);
      res.instances[name] = { available: r.available, used: r.used };
      const merged = newestPerDay(r.instances);
      const rows = [...merged].map(([k, { agg, instance }]) => {
        const [day, territory, source_type] = k.split("|");
        days.add(day);
        const cols = kind === "engagement"
          ? { impressions: agg.impressions, impressions_unique: agg.impressions_unique, page_views: agg.page_views, page_views_unique: agg.page_views_unique }
          : { first_downloads: agg.first_downloads, redownloads: agg.redownloads };
        return { day, territory, source_type, ...cols, instance_date: instance, synced_at: syncedAt };
      });
      for (let i = 0; i < rows.length; i += 500) {
        await spPost("aso_store_daily", rows.slice(i, i + 500), { onConflict: "day,territory,source_type", resolution: "merge" });
      }
      res.rows += rows.length;
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  res.days = [...days].sort();
  res.ok = errors.length === 0;
  return res;
}
