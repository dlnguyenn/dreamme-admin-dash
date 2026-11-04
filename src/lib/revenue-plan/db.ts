/**
 * Server-only REST helpers for the April-plan panels: the internal project
 * (DreamMe Internal: rc_events, ad_insights_daily, user_sources, ...) with the
 * service role, and read-only access to the consumer app project. Never import
 * this from a client component: it holds both service-role keys.
 */
import { PAGE_SIZE, countFromContentRange } from "@/lib/pagedFetch";

const INTERNAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const INTERNAL_KEY = (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";
const CONSUMER_URL = process.env.CONSUMER_SUPABASE_URL ?? "";
const CONSUMER_KEY = process.env.CONSUMER_SERVICE_ROLE_KEY ?? "";

export const internalConfigured = () => !!INTERNAL_URL && !!INTERNAL_KEY;
export const consumerConfigured = () => !!CONSUMER_URL && !!CONSUMER_KEY;

type Project = "internal" | "consumer";

function target(p: Project) {
  const [url, key] = p === "internal" ? [INTERNAL_URL, INTERNAL_KEY] : [CONSUMER_URL, CONSUMER_KEY];
  if (!url || !key) throw new Error(`${p === "internal" ? "Internal" : "Consumer"} Supabase env missing`);
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
}

/** PostgREST says the table is not there (migration not applied yet). */
export class MissingTableError extends Error {}

async function fail(res: Response, path: string): Promise<never> {
  const text = (await res.text()).slice(0, 300);
  if (res.status === 404 && /PGRST205|42P01|Could not find the table|does not exist/i.test(text)) {
    throw new MissingTableError(`${path.split("?")[0]} does not exist yet`);
  }
  throw new Error(`Supabase ${res.status} (${path.split("?")[0]}): ${text}`);
}

export async function sbGet<T>(p: Project, path: string): Promise<T> {
  const { url, headers } = target(p);
  const res = await fetch(`${url}/rest/v1/${path}`, { headers, cache: "no-store" });
  if (!res.ok) await fail(res, path);
  return res.json() as Promise<T>;
}

/** Exact row count for a filter, without transferring rows. */
export async function sbCount(p: Project, path: string): Promise<number> {
  const { url, headers } = target(p);
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: "HEAD",
    headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
    cache: "no-store",
  });
  // HEAD carries no body, so a 404 is the only sign of a missing table.
  if (res.status === 404) throw new MissingTableError(`${path.split("?")[0]} does not exist yet`);
  if (!res.ok) await fail(res, path);
  const n = countFromContentRange(res.headers.get("content-range"));
  if (n == null) throw new Error(`No count for ${path.split("?")[0]}`);
  return n;
}

/**
 * Every row of a filtered select (`path` must carry an order= for stable
 * pages). Pages run one at a time on purpose: rc_events is ~60 MB of mostly
 * raw payloads, and a burst of parallel offset pages (each a full scan until
 * migration 0095's index lands) hit the 8 s statement timeout.
 */
export async function sbAll<T>(p: Project, path: string, maxPages = 40): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < maxPages; i++) {
    const rows = await sbGet<T[]>(p, `${path}&limit=${PAGE_SIZE}&offset=${i * PAGE_SIZE}`);
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
  throw new Error(`${path.split("?")[0]}: more than ${maxPages * PAGE_SIZE} rows; narrow the window`);
}

/** Upsert (merge-duplicates) without echoing rows back. */
export async function sbUpsert(table: string, rows: unknown[], onConflict: string): Promise<void> {
  if (!rows.length) return;
  const { url, headers } = target("internal");
  const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) await fail(res, table);
}

export async function sbDelete(pathWithFilter: string): Promise<void> {
  const { url, headers } = target("internal");
  const res = await fetch(`${url}/rest/v1/${pathWithFilter}`, { method: "DELETE", headers });
  if (!res.ok) await fail(res, pathWithFilter);
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export const num = (v: string | number | null | undefined): number =>
  v == null ? 0 : typeof v === "number" ? v : Number(v) || 0;
