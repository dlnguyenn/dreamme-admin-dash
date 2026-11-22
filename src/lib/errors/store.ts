/**
 * Server-only: the Errors tab's database and storage access (DreamMe
 * Internal, service role). Never import from a client component.
 */
import { gunzipSync } from "node:zlib";
import { TraceMap } from "@jridgewell/trace-mapping";
import { sbGet } from "@/lib/revenue-plan/db";
import type { MapKey } from "./symbolicate";
import { symbolicateExceptions } from "./symbolicate";
import type { ExceptionValue, Summary } from "./event";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";
const headers = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" });
export const BUCKET = "error-sourcemaps";

/** Max events a minute across everything, then 429 (protects Vercel + Supabase). */
export const INGEST_CAP_PER_MINUTE = Number(process.env.ERRORS_CAP_PER_MINUTE ?? 300);
/** Max stored samples per issue (plus the first one from each release). */
export const SAMPLES_PER_ISSUE = 15;

export type IngestStatus = "ok" | "duplicate" | "rate_limited";

export async function ingestEvent(s: Summary, payload: Record<string, unknown>): Promise<{ status: IngestStatus; issue_id?: number; new_issue?: boolean }> {
  const res = await fetch(`${URL_}/rest/v1/rpc/err_ingest`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ e: { ...s, payload }, p_cap: INGEST_CAP_PER_MINUTE, p_samples: SAMPLES_PER_ISSUE }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`err_ingest ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { status: IngestStatus; issue_id?: number; new_issue?: boolean };
}

export interface IssueRow {
  id: number;
  fingerprint: string;
  platform: string | null;
  level: string | null;
  type: string | null;
  value: string | null;
  title: string;
  culprit: string | null;
  mechanism: string | null;
  handled: boolean | null;
  status: "unresolved" | "resolved" | "ignored";
  status_changed_at: string | null;
  status_changed_by: string | null;
  regressed_at: string | null;
  first_seen: string;
  last_seen: string;
  first_release: string | null;
  last_release: string | null;
  event_count: number;
  user_count: number;
  sample_count: number;
}

export interface DailyRow {
  issue_id: number;
  day: string;
  release: string;
  events: number;
}

export interface EventRow {
  event_id: string;
  issue_id: number;
  occurred_at: string;
  release: string | null;
  dist: string | null;
  environment: string | null;
  platform: string | null;
  os: string | null;
  device: string | null;
  user_id: string | null;
  payload: Record<string, unknown>;
  symbolicated: Record<string, unknown> | null;
  symbolicated_at: string | null;
}

const ISSUE_COLS =
  "id,fingerprint,platform,level,type,value,title,culprit,mechanism,handled,status,status_changed_at,status_changed_by,regressed_at,first_seen,last_seen,first_release,last_release,event_count,user_count,sample_count";

export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
export const daysAgo = (now: Date, n: number) => dayKey(new Date(now.getTime() - n * 86_400_000));

export async function listIssues(now = new Date()) {
  const [issues, daily] = await Promise.all([
    sbGet<IssueRow[]>("internal", `err_issues?select=${ISSUE_COLS}&order=last_seen.desc&limit=500`),
    sbGet<DailyRow[]>("internal", `err_issue_daily?select=issue_id,day,release,events&day=gte.${daysAgo(now, 29)}&limit=20000`),
  ]);
  return { issues, daily };
}

export async function getIssue(id: number, now = new Date()) {
  const [issues, daily, samples] = await Promise.all([
    sbGet<IssueRow[]>("internal", `err_issues?select=${ISSUE_COLS}&id=eq.${id}`),
    sbGet<DailyRow[]>("internal", `err_issue_daily?select=issue_id,day,release,events&issue_id=eq.${id}&day=gte.${daysAgo(now, 29)}&order=day.asc`),
    sbGet<Omit<EventRow, "payload" | "symbolicated">[]>(
      "internal",
      `err_events?select=event_id,issue_id,occurred_at,release,dist,environment,platform,os,device,user_id,symbolicated_at&issue_id=eq.${id}&order=occurred_at.desc&limit=50`,
    ),
  ]);
  return { issue: issues[0] ?? null, daily, samples };
}

export async function getEvent(eventId: string): Promise<EventRow | null> {
  if (!/^[0-9a-f]{8,64}$/i.test(eventId)) return null;
  const rows = await sbGet<EventRow[]>("internal", `err_events?select=*&event_id=eq.${eventId}`);
  return rows[0] ?? null;
}

export async function setIssueStatus(id: number, status: IssueRow["status"], by: string) {
  const res = await fetch(`${URL_}/rest/v1/err_issues?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers(), Prefer: "return=representation" },
    body: JSON.stringify({ status, status_changed_at: new Date().toISOString(), status_changed_by: by }),
  });
  if (!res.ok) throw new Error(`update ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as IssueRow[])[0] ?? null;
}

// ---------------------------------------------------------------------------
// Source maps

interface SourcemapRow {
  id: number;
  debug_id: string | null;
  release: string | null;
  dist: string | null;
  bundle: string | null;
  storage_path: string;
  size_bytes: number | null;
  uploaded_at: string;
}

export function storagePathFor(m: { debugId?: string | null; release?: string | null; dist?: string | null; bundle?: string | null }): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._@+-]/g, "_").slice(0, 120);
  if (m.debugId) return `debug-id/${safe(m.debugId.toLowerCase())}.map.gz`;
  return `release/${safe(m.release ?? "none")}/${safe(m.dist ?? "none")}/${safe(m.bundle ?? "bundle")}.map.gz`;
}

/** A signed URL the upload script PUTs the gzipped map to (Vercel caps request bodies at 4.5 MB). */
export async function createSourcemapUpload(m: { debugId: string | null; release: string | null; dist: string | null; bundle: string | null; sizeBytes: number | null }) {
  const path = storagePathFor(m);
  const sign = await fetch(`${URL_}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: { ...headers(), "x-upsert": "true" },
    body: "{}",
  });
  if (!sign.ok) throw new Error(`sign upload ${sign.status}: ${(await sign.text()).slice(0, 200)}`);
  const { url } = (await sign.json()) as { url: string };
  const row = await fetch(`${URL_}/rest/v1/err_sourcemaps?on_conflict=storage_path`, {
    method: "POST",
    headers: { ...headers(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ debug_id: m.debugId?.toLowerCase() ?? null, release: m.release, dist: m.dist, bundle: m.bundle, storage_path: path, size_bytes: m.sizeBytes, uploaded_at: new Date().toISOString() }),
  });
  if (!row.ok) throw new Error(`register map ${row.status}: ${(await row.text()).slice(0, 200)}`);
  return { path, uploadUrl: `${URL_}/storage/v1${url}` };
}

const mapCache = new Map<string, TraceMap>();

async function downloadMap(path: string): Promise<TraceMap | null> {
  const hit = mapCache.get(path);
  if (hit) return hit;
  const res = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${path}`, { headers: headers(), cache: "no-store" });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString("utf8");
  const map = new TraceMap(text);
  // Keep the two most recent: RN maps are 5-30 MB each once parsed.
  if (mapCache.size >= 2) mapCache.delete(mapCache.keys().next().value as string);
  mapCache.set(path, map);
  return map;
}

async function findMap(key: MapKey, release: string | null, dist: string | null): Promise<TraceMap | null> {
  let rows: SourcemapRow[] = [];
  if (key.debugId) {
    rows = await sbGet<SourcemapRow[]>("internal", `err_sourcemaps?select=*&debug_id=eq.${encodeURIComponent(key.debugId.toLowerCase())}&order=uploaded_at.desc&limit=1`);
  }
  if (!rows.length && release) {
    const q = [`release=eq.${encodeURIComponent(release)}`, dist ? `dist=eq.${encodeURIComponent(dist)}` : null, key.bundle ? `bundle=eq.${encodeURIComponent(key.bundle)}` : null]
      .filter(Boolean)
      .join("&");
    rows = await sbGet<SourcemapRow[]>("internal", `err_sourcemaps?select=*&${q}&order=uploaded_at.desc&limit=1`);
  }
  return rows[0] ? downloadMap(rows[0].storage_path) : null;
}

/**
 * The event's exceptions with bundle frames resolved, from the stored copy
 * when there is one. Writes a new result back.
 */
export async function symbolicatedFor(ev: EventRow): Promise<{ exceptions: unknown[]; resolvedFrames: number; missing: string[] } | null> {
  if (ev.symbolicated) return ev.symbolicated as { exceptions: unknown[]; resolvedFrames: number; missing: string[] };
  const exceptions = (ev.payload.exceptions ?? []) as ExceptionValue[];
  const images = (ev.payload.debug_images ?? []) as Record<string, unknown>[];
  const out = await symbolicateExceptions(exceptions, images, (key) => findMap(key, ev.release, ev.dist));
  if (out) {
    await fetch(`${URL_}/rest/v1/err_events?event_id=eq.${ev.event_id}`, {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=minimal" },
      body: JSON.stringify({ symbolicated: out, symbolicated_at: new Date().toISOString() }),
    }).catch(() => undefined);
    // The issue's culprit was taken from a minified bundle frame at ingest
    // ("a(main.jsbundle)"); replace it with the resolved in-app function.
    const main = out.exceptions.at(-1);
    const top = main ? [...main.frames].reverse().find((f) => f.resolved && f.in_app && f.function) : null;
    if (top) {
      const culprit = `${top.function}(${(top.filename ?? "").split("/").pop()})`.slice(0, 300);
      await fetch(`${URL_}/rest/v1/err_issues?id=eq.${ev.issue_id}&or=(culprit.like.*jsbundle*,culprit.like.*.bundle*,culprit.is.null)`, {
        method: "PATCH",
        headers: { ...headers(), Prefer: "return=minimal" },
        body: JSON.stringify({ culprit }),
      }).catch(() => undefined);
    }
  }
  return out;
}
