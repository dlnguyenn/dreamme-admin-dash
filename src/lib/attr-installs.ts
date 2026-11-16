/**
 * attr_installs writes — the install registry behind /api/attr/install.
 * Service-role only (the table has RLS with no policies, rc_events-style).
 * Kept out of the route file so the phase-2 matcher and future Attribution
 * UI reads share one home.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  META_REFERRER_KEY_ENV,
  MetaReferrerBody,
  PlayReferrerBody,
  REFERRER_COLUMNS,
  REFERRER_KEYED_COLUMNS,
  hasReferrerEvidence,
  referrerFieldsFrom,
  resolveReferrers,
  type ReferrerColumns,
} from "@/lib/attr-referrer";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const short = (max: number) => z.string().min(1).max(max);

/** The SDK sends the FULL signal set on every POST (first open, retries,
 *  and the auth-link re-send alike) — the upsert is merge-duplicates, so a
 *  partial body would null out earlier columns. Keep it total. */
export const InstallBody = z.object({
  install_id: z.string().uuid(),
  first_open_at: z.string().datetime({ offset: true }),
  app_user_id: short(128).optional(),
  platform: z.enum(["ios", "android"]).optional(),
  os_version: short(32).optional(),
  device_model: short(64).optional(),
  locale: short(32).optional(),
  timezone: short(64).optional(),
  screen_w: z.number().int().min(1).max(20_000).optional(),
  screen_h: z.number().int().min(1).max(20_000).optional(),
  screen_scale: z.number().min(0.1).max(10).optional(),
  idfv: short(64).optional(),
  app_version: short(32).optional(),
  launch_url: short(2_000).optional(),
  fbclid: short(512).optional(),
  deferred_link: short(2_000).optional(),
  /** iOS ATT decision at first open; absent on Android and older SDK builds. */
  att_status: z.enum(["granted", "denied", "undetermined"]).optional(),
  /** Android install referrers (attr-referrer). A malformed one is dropped,
   *  never rejected: a 400 here would make the SDK retry the whole ping
   *  forever, and `raw` keeps what the app sent either way. */
  install_referrer: PlayReferrerBody.optional().catch(undefined),
  meta_install_referrer: MetaReferrerBody.optional().catch(undefined),
});

export type InstallBodyT = z.infer<typeof InstallBody>;

/** Constant-time string compare (hash first so lengths never leak). */
export function constEq(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** First hop of x-forwarded-for — the client, per Vercel's proxy chain. */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first && first.length <= 64 ? first : null;
}

/** Remove U+0000 from every string in a JSON value. Postgres text and
 *  jsonb both refuse it, so a single NUL anywhere in the body would fail
 *  the upsert on every retry and that install would never be stored. */
export function stripNul<T>(v: T): T {
  if (typeof v === "string") return v.replace(/\u0000/g, "") as T;
  if (Array.isArray(v)) return v.map((x) => stripNul(x)) as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [stripNul(k), stripNul(x)])) as T;
  }
  return v;
}

export interface InstallRow extends Partial<ReferrerColumns> {
  install_id: string;
  first_open_at: string;
  app_user_id: string | null;
  platform: string | null;
  os_version: string | null;
  device_model: string | null;
  locale: string | null;
  timezone: string | null;
  screen_w: number | null;
  screen_h: number | null;
  screen_scale: number | null;
  idfv: string | null;
  app_version: string | null;
  launch_url: string | null;
  fbclid: string | null;
  deferred_link: string | null;
  att_status: string | null;
  ip: string | null;
  ua: string | null;
  raw: Record<string, unknown>;
  updated_at: string;
}

async function sbServiceSelect<T>(path: string): Promise<T[]> {
  if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("service role not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`attr read failed (${path.split("?")[0]}): ${res.status}`);
  return (await res.json()) as T[];
}

/** PGRST204 = unknown column: this code is deployed and the migration
 *  that adds the column is not applied yet. */
const isUnknownColumn = (status: number, text: string) => status === 400 && text.includes("PGRST204");

/** The row without the referrer columns (migration
 *  20261105_attr_install_referrers). Pure, exported for tests. */
export function withoutReferrerColumns<T extends object>(row: T): T {
  const legacy = { ...row } as Record<string, unknown>;
  for (const k of REFERRER_COLUMNS) delete legacy[k];
  return legacy as T;
}

export async function upsertInstall(row: InstallRow): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("service role not configured");
  const post = (body: InstallRow) =>
    fetch(`${SUPABASE_URL}/rest/v1/attr_installs?on_conflict=install_id`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(body),
    });
  let res = await post(row);
  if (!res.ok) {
    const text = await res.text();
    // A lost install is far worse than one without extracted referrer
    // columns: `raw` still holds the referrers, so retry without them.
    if (!isUnknownColumn(res.status, text)) {
      throw new Error(`attr_installs write failed: ${res.status} ${text}`);
    }
    res = await post(withoutReferrerColumns(row));
    if (!res.ok) throw new Error(`attr_installs write failed: ${res.status} ${await res.text()}`);
  }
}

// ── clicks + matching I/O (phase 2) ────────────────────────────────────

import {
  REFERRER_METHODS,
  collapseDuplicateTaps,
  ipPrefixRange,
  parseClickUa,
  pickMatch,
  type ClickCandidate,
  type InstallForMatch,
  type MatchVerdict,
} from "@/lib/attr-match";
import { isBot } from "@/lib/attr-bots";

export interface ClickRow {
  /** Minted by the /l route so the page can address its own row (beacon). */
  click_id?: string;
  clicked_at: string;
  ip: string | null;
  ua: string | null;
  platform_hint: string | null;
  media_source: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string | null;
  ad_name: string | null;
  fbclid: string | null;
  fbp: string | null;
  placement: string | null;
  site_source_name: string | null;
  creator_code: string | null;
  /** The inviter's code on a /i/<code> invite link (migration 0118). */
  invite_code?: string | null;
  landing: string | null;
  raw: Record<string, unknown>;
  // device fingerprint parsed from the UA at insert (migration 0086)
  model?: string | null;
  os_version?: string | null;
  screen_scale?: number | null;
  screen_w?: number | null;
  screen_h?: number | null;
  lang?: string | null;
}

/** Columns added by dash migrations 0085 / 0086; dropped on retry if the
 *  migration is not applied yet (PGRST204 = unknown column). */
const CLICK_COLUMNS_0085 = ["fbp", "placement", "site_source_name"] as const;
const CLICK_COLUMNS_0086 = ["model", "os_version", "screen_scale", "screen_w", "screen_h", "lang"] as const;
const CLICK_COLUMNS_0118 = ["invite_code"] as const;
const FINGERPRINT_SELECT = "model,os_version,screen_scale,screen_w,screen_h,timezone,lang";

export async function insertClick(row: ClickRow): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("service role not configured");
  const post = (body: Record<string, unknown>) =>
    fetch(`${SUPABASE_URL}/rest/v1/attr_clicks`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
    });
  let res = await post({ ...row });
  if (!res.ok) {
    const text = await res.text();
    // PGRST204 = unknown column: the code shipped before the migration. A
    // lost click is worse than a click without fbp (raw keeps the params).
    if (res.status !== 400 || !text.includes("PGRST204")) {
      throw new Error(`attr_clicks write failed: ${res.status} ${text}`);
    }
    const legacy: Record<string, unknown> = { ...row };
    for (const k of [...CLICK_COLUMNS_0085, ...CLICK_COLUMNS_0086, ...CLICK_COLUMNS_0118]) delete legacy[k];
    legacy.raw = { ...row.raw, _fbp: row.fbp, ...(row.invite_code ? { _invite_code: row.invite_code } : {}) };
    res = await post(legacy);
    if (!res.ok) throw new Error(`attr_clicks write failed: ${res.status} ${await res.text()}`);
  }
}

// ── the /l beacon (client-side device signals) ─────────────────────────

/** What the /l page reports about itself before redirecting: screen in
 *  CSS points, devicePixelRatio, navigator.language, the Intl timezone and
 *  the AppleWebKit build from the UA. Fills the fingerprint for browsers
 *  whose UA says only "iPhone" and adds the one field no UA carries
 *  (timezone). The click id is the only key; an unknown id updates nothing. */
export const BeaconBody = z.object({
  c: z.string().uuid(),
  w: z.number().int().min(1).max(20_000).optional(),
  h: z.number().int().min(1).max(20_000).optional(),
  dpr: z.number().min(0.1).max(10).optional(),
  lang: z.string().min(1).max(32).optional(),
  tz: z.string().min(1).max(64).optional(),
  wk: z.string().min(1).max(32).optional(),
});
export type BeaconBodyT = z.infer<typeof BeaconBody>;

/** The PATCH a beacon turns into. Pure, exported for tests. Model and OS
 *  stay as the UA parsed them (a beacon never carries them); screen, scale,
 *  language and timezone come from the page itself. */
export function beaconPatch(b: BeaconBodyT, nowIso: string): Record<string, unknown> {
  const patch: Record<string, unknown> = { beacon_at: nowIso };
  if (b.w && b.h) {
    patch.screen_w = b.w;
    patch.screen_h = b.h;
  }
  if (b.dpr) patch.screen_scale = Math.round(b.dpr * 100) / 100;
  if (b.lang) patch.lang = b.lang;
  if (b.tz) patch.timezone = b.tz;
  if (b.wk) patch.webkit = b.wk;
  return patch;
}

/** First beacon wins (beacon_at is null), so a replayed or forged beacon
 *  cannot rewrite a click after the fact. Never throws. */
export async function applyBeacon(b: BeaconBodyT): Promise<boolean> {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE) return false;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/attr_clicks?click_id=eq.${encodeURIComponent(b.c)}&beacon_at=is.null`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(beaconPatch(b, new Date().toISOString())),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** The install columns the matcher reads (the fingerprint side), plus the
 *  two referrer objects straight out of `raw`, so the re-sweep works whether
 *  or not the extracted referrer columns exist yet. */
export const INSTALL_MATCH_SELECT =
  "install_id,ip,platform,first_open_at,device_model,os_version,screen_scale,screen_w,screen_h,timezone,locale" +
  ",install_referrer:raw->install_referrer,meta_install_referrer:raw->meta_install_referrer";

export type InstallToMatch = InstallForMatch & { install_id: string };

type CandidateClick = ClickCandidate & { ua: string | null };

const clickSelect = (withFingerprint: boolean) =>
  "click_id,clicked_at,ip,platform_hint,fbclid,ua" + (withFingerprint ? "," + FINGERPRINT_SELECT : "");

/** Clicks in the install's IP neighbourhood (same /24 or /64, which
 *  includes the exact IP), newest first. Falls back to the exact IP when the
 *  address does not parse, and to the pre-0086 column set when the
 *  migration is not applied yet. */
async function fetchCandidateClicks(install: InstallToMatch): Promise<CandidateClick[]> {
  const since = new Date(Date.parse(install.first_open_at) - 7 * 24 * 60 * 60 * 1000).toISOString();
  const range = ipPrefixRange(install.ip);
  const where = range
    ? `&ip=gte.${encodeURIComponent(range.lo)}&ip=lte.${encodeURIComponent(range.hi)}`
    : `&ip=eq.${encodeURIComponent(install.ip ?? "")}`;
  const query = (select: string) =>
    `attr_clicks?select=${select}${where}&clicked_at=gte.${encodeURIComponent(since)}&order=clicked_at.desc&limit=100`;
  try {
    return await sbServiceSelect(query(clickSelect(true)));
  } catch {
    return await sbServiceSelect(query(clickSelect(false)));
  }
}

/** The one click a Play referrer names. Fetched by id because it is often
 *  NOT in the install's IP neighbourhood (tapped on wifi, opened on mobile
 *  data), which is exactly the install the IP tiers lose. */
async function fetchClickById(clickId: string): Promise<CandidateClick[]> {
  const query = (select: string) =>
    "attr_clicks?select=" + select + "&click_id=eq." + encodeURIComponent(clickId) + "&limit=1";
  try {
    return await sbServiceSelect(query(clickSelect(true)));
  } catch {
    return await sbServiceSelect(query(clickSelect(false)));
  }
}

/** Which rows a verdict may be written to (a PostgREST filter). An IP
 *  verdict only fills an install nothing has decided yet. A referrer
 *  verdict may also replace an IP verdict (the referrer can arrive on a
 *  later POST than the first open), and is itself never replaced. Pure,
 *  exported for tests. */
export function verdictGuard(method: MatchVerdict["method"]): string {
  return REFERRER_METHODS.has(method)
    ? "or=(match_method.is.null,match_method.not.in.(play_referrer,meta_referrer))"
    : "matched_click_id=is.null&match_method=is.null";
}

/** The columns a verdict writes. A referrer verdict also writes the ids the
 *  referrer named (`keyed`), so an install that arrived before the
 *  decryption key was configured is completed by the daily re-sweep. Pure,
 *  exported for tests. */
export function verdictPatch(
  verdict: MatchVerdict,
  nowIso: string,
  keyed?: Partial<ReferrerColumns>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    matched_click_id: verdict.click?.click_id ?? null,
    match_method: verdict.method,
    match_confidence: verdict.confidence,
    updated_at: nowIso,
  };
  if (keyed && REFERRER_METHODS.has(verdict.method)) {
    for (const k of REFERRER_KEYED_COLUMNS) if (keyed[k] != null) patch[k] = keyed[k];
  }
  return patch;
}

/** Best-effort matching for one install. A referrer decides first; failing
 *  that, last-click over the IP neighbourhood. Writes the matched_* columns
 *  under verdictGuard. Never throws: matching must not fail the install ack. */
export async function matchInstallNow(
  install: InstallToMatch,
  keyed?: Partial<ReferrerColumns>,
): Promise<"matched" | "unmatched" | "skipped"> {
  try {
    if (!install.ip && !hasReferrerEvidence(install.referrer)) return "skipped";
    const namedId = install.referrer?.play_click_id;
    const [named, nearby] = await Promise.all([
      namedId ? fetchClickById(namedId).catch(() => [] as CandidateClick[]) : ([] as CandidateClick[]),
      install.ip ? fetchCandidateClicks(install) : ([] as CandidateClick[]),
    ]);
    const verdict = pickMatch(install, [
      // the click a referrer names is taken as logged: no bot filter
      ...named.map((c) => withUaFingerprint(c)),
      ...nearby
        .filter((c) => !named.some((n) => n.click_id === c.click_id))
        // rows written before the /l bot filter existed are still in the table
        .filter((c) => !isBot(c.ua, c.ip))
        // rows written before 0086 (or before the beacon) carry no parsed
        // fingerprint; the UA still does
        .map((c) => withUaFingerprint(c)),
    ]);
    if (!verdict) return "unmatched";
    const patch = (body: Record<string, unknown>) =>
      fetch(
        `${SUPABASE_URL}/rest/v1/attr_installs?install_id=eq.${install.install_id}&${verdictGuard(verdict.method)}`,
        {
          method: "PATCH",
          headers: {
            apikey: SERVICE_ROLE,
            Authorization: `Bearer ${SERVICE_ROLE}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify(body),
        },
      );
    const now = new Date().toISOString();
    let res = await patch(verdictPatch(verdict, now, keyed));
    if (!res.ok && isUnknownColumn(res.status, await res.text())) {
      // referrer columns not migrated in yet: the verdict itself still lands
      res = await patch(verdictPatch(verdict, now));
    }
    return res.ok ? "matched" : "unmatched";
  } catch {
    return "skipped";
  }
}

/** Stored fingerprint columns win; whatever is missing is parsed from the
 *  UA on the fly. Pure, exported for tests. */
export function withUaFingerprint<T extends ClickCandidate & { ua: string | null }>(c: T): T {
  const fp = parseClickUa(c.ua);
  return {
    ...c,
    model: c.model ?? fp.model ?? null,
    os_version: c.os_version ?? fp.os_version ?? null,
    screen_scale: c.screen_scale ?? fp.screen_scale ?? null,
    screen_w: c.screen_w ?? fp.screen_w ?? null,
    screen_h: c.screen_h ?? fp.screen_h ?? null,
    lang: c.lang ?? fp.lang ?? null,
  };
}

type RawReportClick = import("@/lib/attr-report").ReportClick & {
  ua: string | null;
  ip: string | null;
  fbclid: string | null;
};

/** Historical rows predate the /l bot filter, and in-app browsers double
 *  load; the report must count taps, not requests. Pure, exported for tests. */
export function cleanReportClicks(rows: RawReportClick[]): import("@/lib/attr-report").ReportClick[] {
  return collapseDuplicateTaps(rows.filter((c) => !isBot(c.ua, c.ip))).map(
    ({ click_id, clicked_at, ad_id, ad_name, campaign_name }) => ({
      click_id,
      clicked_at,
      ad_id,
      ad_name,
      campaign_name,
    }),
  );
}

/** Everything the Attribution tab / attribution_overview tool needs, in one
 *  fetch pass (30-day window). Tables are service-role only, so all reads go
 *  through the server; the report arithmetic itself is pure (attr-report). */
export async function fetchAttributionInputs(days = 30): Promise<{
  clicks: import("@/lib/attr-report").ReportClick[];
  installs: import("@/lib/attr-report").ReportInstall[];
  trials: import("@/lib/attr-report").ReportTrial[];
}> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const enc = encodeURIComponent(since);
  const [rawClicks, installs, trials] = await Promise.all([
    sbServiceSelect<RawReportClick>(
      `attr_clicks?select=click_id,clicked_at,ad_id,ad_name,campaign_name,ua,ip,fbclid&clicked_at=gte.${enc}&order=clicked_at.desc&limit=5000`,
    ),
    sbServiceSelect<import("@/lib/attr-report").ReportInstall>(
      `attr_installs?select=install_id,first_open_at,app_user_id,platform,matched_click_id,match_confidence&first_open_at=gte.${enc}&order=first_open_at.desc&limit=5000`,
    ),
    sbServiceSelect<import("@/lib/attr-report").ReportTrial>(
      `rc_events?select=app_user_id,dm_install_id,price_usd,event_at&type=eq.INITIAL_PURCHASE&period_type=eq.TRIAL&environment=eq.PRODUCTION&event_at=gte.${enc}&order=event_at.desc&limit=5000`,
    ),
  ]);
  return { clicks: cleanReportClicks(rawClicks), installs, trials };
}

type RematchRow = Omit<InstallToMatch, "referrer"> & {
  install_referrer: unknown;
  meta_install_referrer: unknown;
};

/** The daily re-sweep: installs from the last 7 days that nothing has
 *  decided (the click row landed after the install ping, the matcher was
 *  down, or the Meta decryption key was added after the install arrived).
 *  Referrers are re-read from `raw` with the key as it is now. Rows with
 *  neither an IP nor a referrer are skipped by matchInstallNow. Returns
 *  counts for the cron's response. */
export async function rematchRecentInstalls(limit = 200): Promise<{
  scanned: number;
  matched: number;
}> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await sbServiceSelect<RematchRow>(
    `attr_installs?select=${INSTALL_MATCH_SELECT}` +
      `&matched_click_id=is.null&match_method=is.null&first_open_at=gte.${encodeURIComponent(since)}` +
      `&order=first_open_at.desc&limit=${limit}`,
  );
  const key = process.env[META_REFERRER_KEY_ENV];
  let matched = 0;
  for (const { install_referrer, meta_install_referrer, ...r } of rows) {
    const { columns, evidence } = resolveReferrers(
      referrerFieldsFrom({ install_referrer, meta_install_referrer }),
      key,
    );
    if ((await matchInstallNow({ ...r, referrer: evidence }, columns)) === "matched") matched++;
  }
  return { scanned: rows.length, matched };
}
