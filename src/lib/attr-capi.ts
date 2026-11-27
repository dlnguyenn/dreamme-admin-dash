/**
 * Attribution phase 3a — the CAPI forwarder's PURE core.
 *
 * (installs, clicks, rc_events, already-logged keys) -> Meta Conversions API
 * events, pinned by tests/attr-capi.test.ts. The route
 * (src/app/api/cron/attr-capi/route.ts) only fetches rows, resolves emails,
 * POSTs the batches and writes attr_capi_log; every decision about WHICH
 * conversions go to Meta and WHAT they look like lives here.
 *
 * Why this exists: the redirect link (/l) + matcher give us, per install,
 * the click that bought it — ip, user agent, fbclid, fbp, campaign/ad ids.
 * Meta only learns that a web-objective campaign produced an install or a
 * trial if we hand those click signals back on the conversion event. So
 * every attributed install / trial start / first paid start is posted as a
 * WEBSITE event (this dataset accepts app-sourced custom events and silently
 * drops them — verified in Events Manager 2026-09-22).
 *
 * Three kinds, mirroring Appstack's EAC loop (teardown 2026-10-05):
 *   install    -> "Lead". Meta has no Install standard event, so Appstack
 *                 hard-maps installs to Lead. This is the volume signal:
 *                 installs/day instead of ~1 trial/day.
 *   trial      -> sent only once QUALIFIED: still not cancelled
 *                 `qualifyMs` (default 120 min, Appstack's default) after it
 *                 started. Instant cancels never reach Meta.
 *   subscribe  -> the first paid start, carrying real revenue.
 *
 * Event NAMES depend on the dataset (eventNamesFor):
 *   shared dataset 1777837186267557 -> Lead / attr_start_trial / attr_subscribe.
 *     RevenueCat's own Meta integration posts StartTrial/Subscribe there
 *     with an event_id we cannot see, so our trial/paid names must differ.
 *   dedicated attributed-only dataset (META_ATTR_DATASET_ID) -> Lead /
 *     StartTrial / Subscribe, Meta's standard names, as Appstack does.
 *
 * event_id: install_id for Lead, original_transaction_id for the others
 * (Meta dedupes on event_name + event_id; attr_capi_log is keyed on
 * dataset_id + event_name + event_id).
 *
 * Joins:
 *   rc_event -> install   via dm_install_id (3b) first, app_user_id fallback
 *   install  -> click     via matched_click_id, confidence high|medium only
 *
 * Selection:
 *   trial      = INITIAL_PURCHASE + period_type TRIAL, qualified
 *   subscribe  = the EARLIEST period_type NORMAL event for that
 *                original_transaction_id (INITIAL_PURCHASE for a no-trial
 *                buy, RENEWAL for a trial conversion); later renewals never
 *                qualify
 *   install    = matched install whose click came from a Meta link
 *   environment PRODUCTION only; one send per (event_name, event_id); events
 *   older than MAX_EVENT_AGE_MS are dropped (Meta rejects event_time > 7d)
 */

import { createHash } from "node:crypto";

export const EVENT_SOURCE_URL = "https://go.dreamme.life/l";
export const MAX_BATCH = 1000;
/** Meta rejects events whose event_time is more than 7 days in the past. */
export const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The dataset RevenueCat's integration and the dash's CAPI crons post into. */
export const SHARED_DATASET_ID = "1777837186267557";

/** Trial qualification window: Appstack's default, and its allowed range. */
export const DEFAULT_QUALIFY_MINUTES = 120;
export const MIN_QUALIFY_MINUTES = 30;
export const MAX_QUALIFY_MINUTES = 1440;

export function qualifyMinutes(raw: string | undefined): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) return DEFAULT_QUALIFY_MINUTES;
  return Math.min(Math.max(Math.round(n), MIN_QUALIFY_MINUTES), MAX_QUALIFY_MINUTES);
}

export type EventKind = "install" | "trial" | "subscribe";
export type CapiEventName = "Lead" | "attr_start_trial" | "attr_subscribe" | "StartTrial" | "Subscribe";
export type EventNames = Record<EventKind, CapiEventName>;

export const SHARED_NAMES: EventNames = { install: "Lead", trial: "attr_start_trial", subscribe: "attr_subscribe" };
export const STANDARD_NAMES: EventNames = { install: "Lead", trial: "StartTrial", subscribe: "Subscribe" };

/** Standard names only where nothing else posts them. */
export function eventNamesFor(datasetId: string): EventNames {
  return datasetId === SHARED_DATASET_ID ? SHARED_NAMES : STANDARD_NAMES;
}

export const ELIGIBLE_CONFIDENCE = new Set(["high", "medium"]);

/** The matcher's `network` tier (same /24 or /64 + fingerprint, no exact
 *  IP) is stored and reported but NOT forwarded to Meta until the
 *  2026-10-05 placebo sizing has been re-run against it. Flip with
 *  ATTR_CAPI_NETWORK_TIER=1. */
export const FORWARD_NETWORK_TIER = process.env.ATTR_CAPI_NETWORK_TIER === "1";

// ── row shapes (the columns the route selects) ─────────────────────────

export interface CapiInstall {
  install_id: string;
  first_open_at: string;
  app_user_id: string | null;
  matched_click_id: string | null;
  match_confidence: string | null;
  /** exact_ip | network (v2), ip_ua_time (v1 rows); absent on old selects */
  match_method?: string | null;
}

export interface CapiClick {
  click_id: string;
  clicked_at: string;
  ip: string | null;
  ua: string | null;
  fbclid: string | null;
  fbp: string | null;
  media_source: string | null;
  campaign_id: string | null;
  ad_id: string | null;
}

export interface CapiRcEvent {
  id: string;
  type: string;
  period_type: string | null;
  environment: string | null;
  event_at: string;
  app_user_id: string | null;
  dm_install_id: string | null;
  original_transaction_id: string | null;
  price_usd: number | null;
}

/** One conversion the forwarder should send. `rc` is null for installs. */
export interface Conversion {
  kind: EventKind;
  event_name: CapiEventName;
  event_id: string; // install_id (install) | original_transaction_id
  event_at: string;
  install: CapiInstall;
  click: CapiClick;
  rc: CapiRcEvent | null;
}

export const logKey = (eventName: string, eventId: string) => `${eventName}:${eventId}`;

// ── selection (pure) ───────────────────────────────────────────────────

export function classify(ev: CapiRcEvent): Exclude<EventKind, "install"> | null {
  if (ev.environment !== "PRODUCTION") return null;
  if (ev.type === "INITIAL_PURCHASE" && ev.period_type === "TRIAL") return "trial";
  if ((ev.type === "INITIAL_PURCHASE" || ev.type === "RENEWAL") && ev.period_type === "NORMAL") {
    return "subscribe";
  }
  return null;
}

export interface SelectOptions {
  /** "now" for the age and qualification checks; injectable for tests. */
  now?: number;
  maxEventAgeMs?: number;
  /** Event names for the target dataset (default: the shared dataset's). */
  names?: EventNames;
  /** Trial qualification window (default 120 min). */
  qualifyMs?: number;
}

const isEligibleInstall = (i: CapiInstall | undefined): i is CapiInstall & { matched_click_id: string } =>
  !!i?.matched_click_id &&
  ELIGIBLE_CONFIDENCE.has(i.match_confidence ?? "") &&
  (i.match_method !== "network" || FORWARD_NETWORK_TIER);

/**
 * Pick the trial / paid conversions to forward. `logged` holds
 * `logKey(event_name, event_id)` for rows already decided (sent) in the
 * target dataset, so a second run over the same inputs yields nothing.
 * `rcEvents` may include NORMAL events from before the lookback window (the
 * route fetches each candidate otid's paid history) so "first paid start" is
 * decided over the whole subscription, and CANCELLATION events, which
 * disqualify a trial cancelled inside the qualification window.
 */
export function selectConversions(
  installs: CapiInstall[],
  clicks: CapiClick[],
  rcEvents: CapiRcEvent[],
  logged: Set<string>,
  opts: SelectOptions = {},
): Conversion[] {
  const now = opts.now ?? Date.now();
  const maxAge = opts.maxEventAgeMs ?? MAX_EVENT_AGE_MS;
  const names = opts.names ?? SHARED_NAMES;
  const qualifyMs = opts.qualifyMs ?? DEFAULT_QUALIFY_MINUTES * 60_000;

  const clickById = new Map(clicks.map((c) => [c.click_id, c]));
  const installById = new Map(installs.map((i) => [i.install_id, i]));
  const installByUser = new Map<string, CapiInstall>();
  for (const i of installs) {
    // first registered install per user wins the fallback join
    if (i.app_user_id && !installByUser.has(i.app_user_id)) installByUser.set(i.app_user_id, i);
  }

  // Cancellation times per subscription (auto-renew turned off).
  const cancelsByOtid = new Map<string, number[]>();
  for (const ev of rcEvents) {
    if (ev.type !== "CANCELLATION" || !ev.original_transaction_id) continue;
    const at = Date.parse(ev.event_at);
    if (!Number.isFinite(at)) continue;
    const list = cancelsByOtid.get(ev.original_transaction_id) ?? [];
    list.push(at);
    cancelsByOtid.set(ev.original_transaction_id, list);
  }

  // Earliest event per (kind, otid) — rc_events carries re-sends, and
  // subscribe must be the FIRST paid start of the subscription.
  const earliest = new Map<string, { kind: Exclude<EventKind, "install">; ev: CapiRcEvent }>();
  for (const ev of rcEvents) {
    const kind = classify(ev);
    if (!kind || !ev.original_transaction_id) continue;
    const at = Date.parse(ev.event_at);
    if (!Number.isFinite(at)) continue;
    const key = `${kind}:${ev.original_transaction_id}`;
    const cur = earliest.get(key);
    if (!cur || at < Date.parse(cur.ev.event_at)) earliest.set(key, { kind, ev });
  }

  const out: Conversion[] = [];
  for (const { kind, ev } of earliest.values()) {
    const otid = ev.original_transaction_id!;
    const eventName = names[kind];
    if (logged.has(logKey(eventName, otid))) continue;
    const at = Date.parse(ev.event_at);
    if (now - at > maxAge) continue; // Meta would reject it anyway
    if (kind === "trial") {
      if (now - at < qualifyMs) continue; // not qualified YET; a later tick decides
      const cancels = cancelsByOtid.get(otid) ?? [];
      if (cancels.some((t) => t < at + qualifyMs)) continue; // cancelled inside the window
    }
    const install =
      (ev.dm_install_id ? installById.get(ev.dm_install_id) : undefined) ??
      (ev.app_user_id ? installByUser.get(ev.app_user_id) : undefined);
    if (!isEligibleInstall(install)) continue;
    const click = clickById.get(install.matched_click_id);
    if (!click) continue;
    out.push({ kind, event_name: eventName, event_id: otid, event_at: ev.event_at, install, click, rc: ev });
  }
  // deterministic order: oldest conversion first
  out.sort((a, b) => Date.parse(a.event_at) - Date.parse(b.event_at));
  return out;
}

/**
 * Pick the installs to forward as Lead: matched at high/medium confidence
 * to a click from a Meta ad link (src=meta; creator and test links are not
 * Meta's to learn from), first open within Meta's 7-day limit, not already
 * logged. event_time is the first open, whenever the matcher got to it.
 */
export function selectInstallConversions(
  installs: CapiInstall[],
  clicks: CapiClick[],
  logged: Set<string>,
  opts: SelectOptions = {},
): Conversion[] {
  const now = opts.now ?? Date.now();
  const maxAge = opts.maxEventAgeMs ?? MAX_EVENT_AGE_MS;
  const names = opts.names ?? SHARED_NAMES;
  const clickById = new Map(clicks.map((c) => [c.click_id, c]));

  const out: Conversion[] = [];
  const seen = new Set<string>();
  for (const install of installs) {
    if (seen.has(install.install_id)) continue;
    seen.add(install.install_id);
    if (!isEligibleInstall(install)) continue;
    if (logged.has(logKey(names.install, install.install_id))) continue;
    const at = Date.parse(install.first_open_at);
    if (!Number.isFinite(at) || now - at > maxAge) continue;
    const click = clickById.get(install.matched_click_id);
    if (!click || click.media_source !== "meta") continue;
    out.push({
      kind: "install",
      event_name: names.install,
      event_id: install.install_id,
      event_at: install.first_open_at,
      install,
      click,
      rc: null,
    });
  }
  out.sort((a, b) => Date.parse(a.event_at) - Date.parse(b.event_at));
  return out;
}

// ── payload construction (pure) ────────────────────────────────────────

/** Meta's fbc format: fb.<subdomainIndex>.<creationTime ms>.<fbclid>. With
 *  no _fbc cookie to read, creationTime is "when you first observed this
 *  fbclid" — the click row's clicked_at. Never hashed. */
export function buildFbc(click: Pick<CapiClick, "clicked_at" | "fbclid">): string | null {
  if (!click.fbclid) return null;
  const ms = Date.parse(click.clicked_at);
  if (!Number.isFinite(ms)) return null;
  return `fb.1.${ms}.${click.fbclid}`;
}

/** CAPI hashing: SHA-256 hex of the trimmed, lowercased value. */
export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

/** external_id is opaque to Meta (no normalization rules) — hash the trimmed
 *  value as-is so uuid casing never changes the key. */
export function hashExternalId(id: string): string {
  return createHash("sha256").update(id.trim()).digest("hex");
}

export interface CapiEvent {
  event_name: CapiEventName;
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url: string;
  user_data: {
    fbc?: string;
    fbp?: string;
    client_ip_address?: string;
    client_user_agent?: string;
    em?: string[];
    external_id?: string[];
  };
  custom_data: {
    currency?: "USD";
    value?: number;
    campaign_id: string | null;
    ad_id: string | null;
    match_confidence: string | null;
  };
}

export const userIdOf = (c: Conversion): string | null => c.rc?.app_user_id ?? c.install.app_user_id;

export function buildCapiEvent(c: Conversion, email: string | null): CapiEvent {
  const user_data: CapiEvent["user_data"] = {};
  const fbc = buildFbc(c.click);
  if (fbc) user_data.fbc = fbc;
  if (c.click.fbp) user_data.fbp = c.click.fbp;
  if (c.click.ip) user_data.client_ip_address = c.click.ip;
  if (c.click.ua) user_data.client_user_agent = c.click.ua;
  if (email) user_data.em = [hashEmail(email)];
  const userId = userIdOf(c);
  if (userId) user_data.external_id = [hashExternalId(userId)];

  const custom_data: CapiEvent["custom_data"] = {
    campaign_id: c.click.campaign_id,
    ad_id: c.click.ad_id,
    match_confidence: c.install.match_confidence,
  };
  // Installs and trials carry no value (Appstack: value only on revenue
  // events); the first paid start carries what the user actually paid.
  if (c.kind === "subscribe") {
    const price = c.rc?.price_usd;
    custom_data.currency = "USD";
    custom_data.value = typeof price === "number" && Number.isFinite(price) ? price : 0;
  }

  return {
    event_name: c.event_name,
    event_time: Math.floor(Date.parse(c.event_at) / 1000),
    event_id: c.event_id,
    action_source: "website",
    event_source_url: EVENT_SOURCE_URL,
    user_data,
    custom_data,
  };
}

export function chunk<T>(items: T[], size = MAX_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ── log rows (uniform shape: PostgREST bulk insert needs identical keys) ──

export interface CapiLogRow {
  dataset_id: string;
  event_id: string;
  event_name: CapiEventName;
  install_id: string;
  click_id: string;
  app_user_id: string | null;
  status: "sent" | "send_failed";
  meta_response: unknown;
}

export function buildLogRow(
  c: Conversion,
  datasetId: string,
  status: CapiLogRow["status"],
  metaResponse: unknown,
): CapiLogRow {
  return {
    dataset_id: datasetId,
    event_id: c.event_id,
    event_name: c.event_name,
    install_id: c.install.install_id,
    click_id: c.click.click_id,
    app_user_id: userIdOf(c),
    status,
    meta_response: metaResponse ?? null,
  };
}
