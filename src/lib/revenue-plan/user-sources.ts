/**
 * user_sources (internal, migration 0095): a nightly copy of each consumer
 * user's onboarding answer, so rc_events can join on app_user_id without a
 * cross-project call. Consumer users.id equals the RevenueCat app_user_id.
 *
 *  - Nightly (/api/cron/sync-user-sources): users whose updated_at or
 *    joined_at moved in the last 3 days. A full copy (?full=1, or the Backfill
 *    button on the April Plan tab) walks all ~58k users by id.
 *  - Readers call loadSources(). Until the table exists and has rows (the
 *    migration is applied and backfilled), they read the consumer users table
 *    live instead and say so, so the panels work from day one.
 */
import { MissingTableError, mapLimit, sbCount, sbGet, sbUpsert } from "./db";

export const SYNC_LOOKBACK_DAYS = 3;
const PAGE = 1000;
/** ids per in.() filter: ~37 chars each keeps the URL well under 8 KB. */
const ID_CHUNK = 150;

interface ConsumerUser {
  id: string;
  referral_source: string | null;
  onboarding_completed_at: string | null;
  birthday?: string | null;
  gender?: string | null;
}

/**
 * Birth year from the consumer `birthday`, or null when it can't be trusted.
 * 1995-01-01 is the onboarding picker's default (156 of ~17k recent users sit
 * on it exactly), so it means "not answered", not a birthday. Ages outside
 * 13-100 are typos. Only the year is copied (migration 0101).
 */
export function birthYearOf(birthday: string | null | undefined, now: Date = new Date()): number | null {
  if (!birthday || birthday.startsWith("1995-01-01")) return null;
  const year = Number(birthday.slice(0, 4));
  if (!Number.isInteger(year)) return null;
  const age = now.getUTCFullYear() - year;
  return age >= 13 && age <= 100 ? year : null;
}

export interface SyncResult {
  mode: "full" | "incremental";
  since: string | null;
  read: number;
  written: number;
  ms: number;
}

export async function syncUserSources(opts: { full?: boolean; now?: Date } = {}): Promise<SyncResult> {
  const t0 = Date.now();
  const now = opts.now ?? new Date();
  const since = opts.full ? null : new Date(now.getTime() - SYNC_LOOKBACK_DAYS * 86_400_000).toISOString();
  // Values inside or=() must be quoted: an ISO timestamp holds PostgREST's reserved "." and ":".
  const filter = since ? `&or=(updated_at.gte.%22${since}%22,joined_at.gte.%22${since}%22)` : "";
  const syncedAt = now.toISOString();
  let last = "";
  let read = 0;
  // Keyset paging by id: offsets slow down and can skip rows while users sign up mid-walk.
  for (let page = 0; page < 500; page++) {
    const rows = await sbGet<ConsumerUser[]>(
      "consumer",
      `users?select=id,referral_source,onboarding_completed_at,birthday,gender${filter}${last ? `&id=gt.${last}` : ""}&order=id.asc&limit=${PAGE}`,
    );
    if (!rows.length) break;
    read += rows.length;
    await sbUpsert(
      "user_sources",
      rows.map((r) => ({
        user_id: r.id,
        referral_source: r.referral_source,
        onboarding_completed_at: r.onboarding_completed_at,
        birth_year: birthYearOf(r.birthday, now),
        gender: r.gender ?? null,
        synced_at: syncedAt,
      })),
      "user_id",
    );
    last = rows[rows.length - 1].id;
    if (rows.length < PAGE) break;
  }
  return { mode: opts.full ? "full" : "incremental", since, read, written: read, ms: Date.now() - t0 };
}

export type SourceBackend = "user_sources" | "consumer";

export interface SourceStatus {
  backend: SourceBackend;
  /** Rows in user_sources (null = table missing). */
  rows: number | null;
  lastSyncedAt: string | null;
  /** Shown on the panels when they fall back to the live consumer read. */
  note: string | null;
}

let statusCache: { at: number; value: SourceStatus } | null = null;

/** Which table to read sources from: user_sources once it holds rows, the consumer users table until then. */
export async function sourceStatus(): Promise<SourceStatus> {
  if (statusCache && Date.now() - statusCache.at < 60_000) return statusCache.value;
  let value: SourceStatus;
  try {
    const rows = await sbCount("internal", "user_sources?select=user_id");
    if (rows === 0) {
      value = { backend: "consumer", rows, lastSyncedAt: null, note: "user_sources is empty: reading the consumer users table live until the backfill runs." };
    } else {
      const latest = await sbGet<{ synced_at: string }[]>("internal", "user_sources?select=synced_at&order=synced_at.desc&limit=1");
      value = { backend: "user_sources", rows, lastSyncedAt: latest[0]?.synced_at ?? null, note: null };
    }
  } catch (e) {
    if (!(e instanceof MissingTableError)) throw e;
    value = {
      backend: "consumer",
      rows: null,
      lastSyncedAt: null,
      note: "user_sources does not exist yet (migration 0095 not applied): reading the consumer users table live.",
    };
  }
  statusCache = { at: Date.now(), value };
  return value;
}

export function clearSourceStatusCache() {
  statusCache = null;
}

/** app_user_id -> referral_source (null = skipped the question). Users with no row are absent. */
export async function loadSources(userIds: string[], backend: SourceBackend): Promise<Map<string, string | null>> {
  const ids = [...new Set(userIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
  const pages = await mapLimit(chunks, 6, (chunk) =>
    backend === "user_sources"
      ? sbGet<{ user_id: string; referral_source: string | null }[]>(
          "internal",
          `user_sources?select=user_id,referral_source&user_id=in.(${chunk.join(",")})`,
        ).then((rows) => rows.map((r) => [r.user_id, r.referral_source] as const))
      : sbGet<{ id: string; referral_source: string | null }[]>(
          "consumer",
          `users?select=id,referral_source&id=in.(${chunk.join(",")})`,
        ).then((rows) => rows.map((r) => [r.id, r.referral_source] as const)),
  );
  return new Map(pages.flat());
}

/** Onboardings completed in [fromIso, toIso), all and TikTok-sourced. */
export async function countOnboardings(fromIso: string, toIso: string, backend: SourceBackend): Promise<{ all: number; tiktok: number }> {
  const table = backend === "user_sources" ? "internal" : "consumer";
  const base = `${backend === "user_sources" ? "user_sources?select=user_id" : "users?select=id"}&onboarding_completed_at=gte.${fromIso}&onboarding_completed_at=lt.${toIso}`;
  const [all, tiktok] = await Promise.all([sbCount(table, base), sbCount(table, `${base}&referral_source=eq.tiktok`)]);
  return { all, tiktok };
}
