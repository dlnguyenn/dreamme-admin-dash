/**
 * Attribution phase 2 — click parsing, store routing, and the
 * click↔install matcher.
 *
 * The matcher is PURE ((install, clicks[]) -> verdict) so its behavior is
 * fully pinned by tests/attr-match.test.ts; the I/O wrapper
 * (matchInstallNow / the cron) only fetches candidates and writes the
 * verdict into attr_installs' matched_* columns.
 *
 * Matching model, v3 (v1 was IP + time + platform only; v2 added the
 * fingerprint and the network tier; v3 puts Android install referrers first):
 *   tier play_referrer / meta_referrer = an Android install referrer names
 *                  the click or the ad outright (attr-referrer). No IP, no
 *                  fingerprint, always high. Decided before anything below.
 *   eligibility  = click before install (5min skew allowed) + ≤7 days old +
 *                  click-UA platform not contradicting the install platform +
 *                  no device-fingerprint CONFLICT (model / iOS / scale /
 *                  screen points / timezone, wherever both sides have them)
 *   tier exact_ip = same IP; last-click wins; confidence high (≤1h,
 *                  unambiguous) / medium (≤24h, or ambiguous within the
 *                  hour) / low (older, or ambiguous)
 *   tier network  = same /24 or /64 AND strong fingerprint agreement, only
 *                  when exact_ip found nothing; medium ≤24h, else low
 *
 * The fingerprint is what makes the network tier safe: the Appstack
 * teardown (research_notes/appstack_server_matching_2026-10-14.md) names
 * exactly these tiers, and the 2026-10-05 sizing showed model+iOS alone is
 * a coin flip while the full tuple is not. Confidence is stored so
 * downstream consumers choose their own floor (CAPI takes high+medium and,
 * until measured, excludes the network tier).
 */

import { playReferrerParam, type MetaAdIds, type ReferrerEvidence } from "@/lib/attr-referrer";

const APP_STORE_URL = "https://apps.apple.com/us/app/dreamme-glp-1-tracker-pet/id6755569693";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.dreamme.app";

const MATCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const HIGH_MS = 60 * 60 * 1000;
const MEDIUM_MS = 24 * 60 * 60 * 1000;

// ── click params (the /l redirect) ─────────────────────────────────────

const CLICK_PARAM_MAP: Array<[param: string, column: string, cap: number]> = [
  ["src", "media_source", 32],
  ["c", "campaign_id", 64],
  ["cn", "campaign_name", 200],
  ["as", "adset_id", 64],
  ["asn", "adset_name", 200],
  ["a", "ad_id", 64],
  ["an", "ad_name", 200],
  ["fbclid", "fbclid", 512],
  ["creator", "creator_code", 64],
  // Appstack's ad link also carries these two Meta macros (2026-10-05
  // teardown): pl={{placement}}, ss={{site_source_name}}.
  ["pl", "placement", 64],
  ["ss", "site_source_name", 32],
];

/** Map canonical link params to attr_clicks columns. Unrendered Meta
 *  macros ({{ad.id}} arriving literally) become null — template junk must
 *  never pollute grouping keys. */
export function parseClickParams(sp: URLSearchParams): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [param, column, cap] of CLICK_PARAM_MAP) {
    const v = sp.get(param);
    out[column] = v && v.length > 0 && !v.includes("{{") ? v.slice(0, cap) : null;
  }
  return out;
}

// ── fbp (Meta browser id) ──────────────────────────────────────────────

/** 90 days, the lifetime Meta's pixel gives its own _fbp cookie. */
export const FBP_MAX_AGE_S = 90 * 24 * 60 * 60;
const FBP_RE = /^fb\.\d{1,2}\.\d{10,13}\.[A-Za-z0-9_-]{1,64}$/;

/** Read `_fbp` from a Cookie header, only if it is well-formed. */
export function readFbpCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === "_fbp") {
      const val = v.join("=");
      return FBP_RE.test(val) ? val : null;
    }
  }
  return null;
}

/** Meta's fbp format: fb.<subdomainIndex>.<creationTime ms>.<random int>.
 *  The index is the cookie domain's label count minus one (go.dreamme.life
 *  -> 2); the cookie is host-only, so it is always the request host. */
export function mintFbp(host: string, nowMs: number, random: number): string {
  const labels = host.split(":")[0].split(".").filter(Boolean).length;
  return `fb.${Math.max(0, labels - 1)}.${nowMs}.${random}`;
}

/** Appstack sends fbc AND fbp on attributed events (their teardown names it
 *  the main Event Match Quality driver). We run no pixel, so /l keeps the
 *  visitor's existing _fbp or mints one, and logs it with the click. */
export function resolveFbp(
  cookieHeader: string | null,
  host: string,
  nowMs: number,
  random: number,
): { fbp: string; setCookie: string } {
  const fbp = readFbpCookie(cookieHeader) ?? mintFbp(host, nowMs, random);
  // re-set every visit so the 90 days roll, as Meta's pixel does
  return { fbp, setCookie: `_fbp=${fbp}; Max-Age=${FBP_MAX_AGE_S}; Path=/; Secure; SameSite=Lax` };
}

// ── UA platform + store routing ────────────────────────────────────────

export type UaPlatform = "ios" | "android" | "other";

export function platformFromUa(ua: string | null): UaPlatform {
  if (!ua) return "other";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  return "other";
}

/** Where a tap on the ad link lands. An Android tap carries its own
 *  attr_clicks id into the Play listing as the install referrer
 *  (`&referrer=utm_source=dreamme_link&dm_click=<id>`, percent-encoded), so
 *  the app can hand it back at first open and the install matches this
 *  exact click. The App Store has no equivalent. */
export function storeUrlFor(platform: UaPlatform, clickId?: string): string {
  if (platform !== "android") return APP_STORE_URL;
  const referrer = clickId ? playReferrerParam(clickId) : null;
  return referrer ? `${PLAY_STORE_URL}&referrer=${encodeURIComponent(referrer)}` : PLAY_STORE_URL;
}

// ── device fingerprint (click side <-> install side) ────────────────────
//
// Appstack teardown (2026-10-14): their match request carries ~14 device
// headers and the server gates every tier on them. Our two sides already
// describe the device the same way: the Facebook/Instagram in-app browser
// UA names the exact model and iOS version (FBDV/iPhone17,4; FBSV/26.6.1;
// Instagram's "(iPhone17,4; iOS 26_6_1; en_US; en; scale=3.00; 1125x2436)"),
// and the /l page's beacon adds screen points, dpr, language and timezone
// for browsers whose UA says only "iPhone". Screen is in CSS POINTS on both
// sides (the SDK sends Dimensions, the beacon sends screen.width/height;
// Instagram's pixel tuple is divided by its scale).

export interface Fingerprint {
  model?: string | null;
  os_version?: string | null;
  screen_scale?: number | null;
  screen_w?: number | null;
  screen_h?: number | null;
  timezone?: string | null;
  lang?: string | null;
}

const fbField = (ua: string, key: string): string | null => {
  const m = ua.match(new RegExp(`${key}/([^;\\]]+)`));
  return m ? m[1].trim() : null;
};
// Instagram iOS: "Instagram 448.0.0.39.66 (iPhone17,4; iOS 26_6_1; en_US; en; scale=3.00; 1125x2436; ..."
const IG_IOS_RE =
  /Instagram [\d.]+ \(([^;)]+); iOS ([\d_]+); ([A-Za-z_-]+); [^;)]*; scale=([\d.]+); (\d+)x(\d+)/;

/** Normalise "26_6_1" / "iOS 26.6.1" -> "26.6.1". */
export function normalizeOsVersion(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = v.replace(/_/g, ".").match(/(\d+(?:\.\d+)*)/);
  return m ? m[1] : null;
}

/** What a click's UA reveals about the device. Plain Safari reveals nothing
 *  (every iPhone says "iPhone"); the beacon covers those. */
export function parseClickUa(ua: string | null): Fingerprint {
  const out: Fingerprint = {};
  if (!ua) return out;
  const ig = ua.match(IG_IOS_RE);
  if (ig) {
    const scale = Number(ig[4]);
    out.model = ig[1].trim();
    out.os_version = normalizeOsVersion(ig[2]);
    out.lang = ig[3];
    if (scale > 0) {
      out.screen_scale = scale;
      out.screen_w = Math.round(Number(ig[5]) / scale);
      out.screen_h = Math.round(Number(ig[6]) / scale);
    }
    return out;
  }
  if (/FBAN\/|FBAV\//.test(ua)) {
    out.model = fbField(ua, "FBDV");
    out.os_version = normalizeOsVersion(fbField(ua, "FBSV"));
    const ss = Number(fbField(ua, "FBSS"));
    if (ss > 0) out.screen_scale = ss;
    out.lang = fbField(ua, "FBLC");
  }
  return out;
}

export type FingerprintField = "model" | "os_version" | "screen_scale" | "screen" | "timezone" | "lang";

export interface FingerprintComparison {
  agree: FingerprintField[];
  conflict: FingerprintField[];
}

const langPrimary = (v: string) => v.toLowerCase().replace("_", "-").split("-")[0];
const versionParts = (v: string) => v.split(".").map((n) => Number(n) || 0);

/** Field-by-field agreement. Only fields present on BOTH sides count; a
 *  field missing on either side is neither agreement nor conflict.
 *  os_version is ordered: an install on a NEWER iOS than the click is the
 *  user updating between tap and first open, not a different device. */
export function compareFingerprint(install: Fingerprint, click: Fingerprint): FingerprintComparison {
  const agree: FingerprintField[] = [];
  const conflict: FingerprintField[] = [];
  const mark = (f: FingerprintField, ok: boolean) => (ok ? agree : conflict).push(f);

  if (install.model && click.model) {
    mark("model", install.model.trim().toLowerCase() === click.model.trim().toLowerCase());
  }
  const io = normalizeOsVersion(install.os_version);
  const co = normalizeOsVersion(click.os_version);
  if (io && co) {
    if (io === co) agree.push("os_version");
    else {
      const [a, b] = [versionParts(io), versionParts(co)];
      const newer = a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && (a[2] ?? 0) > (b[2] ?? 0)));
      if (!newer) conflict.push("os_version");
    }
  }
  if (install.screen_scale && click.screen_scale) {
    mark("screen_scale", Math.abs(install.screen_scale - click.screen_scale) <= 0.05);
  }
  if (install.screen_w && install.screen_h && click.screen_w && click.screen_h) {
    const same = (a: number, b: number) => Math.abs(a - b) <= 1;
    mark(
      "screen",
      (same(install.screen_w, click.screen_w) && same(install.screen_h, click.screen_h)) ||
        (same(install.screen_w, click.screen_h) && same(install.screen_h, click.screen_w)),
    );
  }
  if (install.timezone && click.timezone) {
    mark("timezone", install.timezone.trim().toLowerCase() === click.timezone.trim().toLowerCase());
  }
  if (install.lang && click.lang) {
    mark("lang", langPrimary(install.lang) === langPrimary(click.lang));
  }
  return { agree, conflict };
}

/** Enough agreement to trust a click that is NOT on the install's exact IP:
 *  the model plus one more field, or (no model in the UA: Safari + beacon)
 *  screen, scale and one more. lang alone never carries it. */
export function strongAgreement(c: FingerprintComparison): boolean {
  if (c.conflict.length) return false;
  const a = new Set(c.agree);
  if (a.has("model") && a.size >= 2) return true;
  return a.has("screen") && a.has("screen_scale") && a.size >= 3;
}

// ── IP neighbourhood (the `network` tier) ──────────────────────────────

/** The address range a click must fall in to count as "same network":
 *  IPv4 /24, IPv6 /64 (one home or one carrier NAT pool at a time). Returns
 *  inclusive string bounds suitable for inet comparison, or null. */
export function ipPrefixRange(ip: string | null): { lo: string; hi: string; key: string } | null {
  if (!ip) return null;
  let v = ip.trim();
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) v = mapped[1];
  const v4 = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b, c] = [v4[1], v4[2], v4[3]];
    return { lo: `${a}.${b}.${c}.0`, hi: `${a}.${b}.${c}.255`, key: `${a}.${b}.${c}.0/24` };
  }
  if (!v.includes(":")) return null;
  const parts = v.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail].map((g) =>
    g.toLowerCase().replace(/^0+(?=.)/, ""),
  );
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const p = groups.slice(0, 4).join(":");
  return { lo: `${p}::`, hi: `${p}:ffff:ffff:ffff:ffff`, key: `${p}::/64` };
}

// ── the matcher (pure) ─────────────────────────────────────────────────

export interface ClickCandidate extends Fingerprint {
  click_id: string;
  clicked_at: string;
  ip: string | null;
  platform_hint: string | null;
  fbclid: string | null;
}

// ── duplicate taps ─────────────────────────────────────────────────────

/** In-app browsers (Instagram especially) often load the ad link twice
 *  within a few seconds of one tap — same fbclid, same IP. Left alone, the
 *  pair reads as two clicks in reports and as "ambiguous" to the matcher
 *  (costing a confidence notch). */
export const DUPLICATE_TAP_WINDOW_MS = 5 * 60 * 1000;

/** Keep the FIRST row of every same-fbclid run that falls inside the
 *  window; rows without an fbclid are never collapsed. Order-independent
 *  (sorts by time), stable for the survivors. */
export function collapseDuplicateTaps<T extends { fbclid: string | null; clicked_at: string }>(
  clicks: T[],
  windowMs = DUPLICATE_TAP_WINDOW_MS,
): T[] {
  const byTime = [...clicks].sort((a, b) => Date.parse(a.clicked_at) - Date.parse(b.clicked_at));
  const lastKept = new Map<string, number>();
  const out: T[] = [];
  for (const c of byTime) {
    if (!c.fbclid) {
      out.push(c);
      continue;
    }
    const t = Date.parse(c.clicked_at);
    const prev = lastKept.get(c.fbclid);
    if (prev !== undefined && t - prev <= windowMs) continue;
    lastKept.set(c.fbclid, t);
    out.push(c);
  }
  return out;
}

export interface InstallForMatch {
  ip: string | null;
  platform: string | null;
  first_open_at: string;
  device_model?: string | null;
  os_version?: string | null;
  screen_scale?: number | null;
  screen_w?: number | null;
  screen_h?: number | null;
  timezone?: string | null;
  locale?: string | null;
  /** Android install referrers, already parsed and decrypted (attr-referrer). */
  referrer?: ReferrerEvidence | null;
}

/** Deterministic, from an Android install referrer: play_referrer = the
 *  Play Install Referrer named our click or (decrypted) the Meta ad;
 *  meta_referrer = the Meta Install Referrer named the ad. Probabilistic,
 *  in Appstack's vocabulary: exact_ip = same address; network = same /24 or
 *  /64 with the device fingerprint agreeing. */
export type MatchMethod = "play_referrer" | "meta_referrer" | "exact_ip" | "network";

export const REFERRER_METHODS: ReadonlySet<string> = new Set<MatchMethod>(["play_referrer", "meta_referrer"]);

export interface MatchVerdict {
  /** The matched ad-link click. Null only when a Meta referrer named the ad
   *  and no click of ours was involved (see `ad`). */
  click: ClickCandidate | null;
  confidence: "high" | "medium" | "low";
  method: MatchMethod;
  /** fingerprint fields that agreed on the winning click (diagnostics) */
  agreed: FingerprintField[];
  /** The ad a decrypted Meta referrer named (referrer methods only). */
  ad?: MetaAdIds;
}

export function installFingerprint(i: InstallForMatch): Fingerprint {
  return {
    model: i.device_model ?? null,
    os_version: i.os_version ?? null,
    screen_scale: i.screen_scale ?? null,
    screen_w: i.screen_w ?? null,
    screen_h: i.screen_h ?? null,
    timezone: i.timezone ?? null,
    lang: i.locale ?? null,
  };
}

function timeEligible(click: ClickCandidate, installAt: number): boolean {
  const clickedAt = Date.parse(click.clicked_at);
  if (!Number.isFinite(clickedAt)) return false;
  const age = installAt - clickedAt;
  return age >= -CLOCK_SKEW_MS && age <= MATCH_WINDOW_MS;
}

/** An Android-browser click cannot own an iOS install; unknown UAs pass. */
function platformEligible(install: InstallForMatch, click: ClickCandidate): boolean {
  return !(
    install.platform &&
    click.platform_hint &&
    click.platform_hint !== "other" &&
    click.platform_hint !== install.platform
  );
}

type Scored = { c: ClickCandidate; cmp: FingerprintComparison };
const newestFirst = (a: Scored, b: Scored) => Date.parse(b.c.clicked_at) - Date.parse(a.c.clicked_at);
const notch = (x: MatchVerdict["confidence"]): MatchVerdict["confidence"] => (x === "high" ? "medium" : "low");

/** A referrer verdict needs no IP and no fingerprint: Play hands a referrer
 *  only to the device that installed from that tap, and Meta's payload is
 *  encrypted to our key. Order is last-click, click before view:
 *    1. Play referrer carrying one of OUR click ids -> that exact click
 *       (looked up in the uncollapsed list: it may be the second load of a
 *       double tap). No time check either: first_open_at is the phone's
 *       clock, and a wrong clock must not undo an exact match.
 *    2. Play referrer carrying a Meta payload -> the Meta ad, a click that
 *       went through the Play listing.
 *    3. Meta referrer -> the Meta ad, a click or a view Play never saw. */
function referrerMatch(install: InstallForMatch, clicks: ClickCandidate[]): MatchVerdict | null {
  const ref = install.referrer;
  if (!ref) return null;
  if (ref.play_click_id) {
    const id = ref.play_click_id.toLowerCase();
    const c = clicks.find((x) => x.click_id.toLowerCase() === id);
    if (c) return { click: c, confidence: "high", method: "play_referrer", agreed: [] };
  }
  if (ref.play_meta?.campaign_id) {
    return { click: null, confidence: "high", method: "play_referrer", agreed: [], ad: ref.play_meta };
  }
  if (ref.meta?.campaign_id) {
    return { click: null, confidence: "high", method: "meta_referrer", agreed: [], ad: ref.meta };
  }
  return null;
}

/**
 * Matching model, v3:
 *   tier 0 `play_referrer` / `meta_referrer`: an Android install referrer
 *     names the click or the ad (referrerMatch above). Always high, and
 *     always ahead of the IP tiers.
 *   tier 1 `exact_ip`: same IP + time window + platform + NO fingerprint
 *     conflict (a same-NAT neighbour on a different phone is rejected).
 *     Confidence by age as before; ambiguity among survivors costs a notch.
 *   tier 2 `network`: only when tier 1 is empty. Same /24 (v4) or /64 (v6),
 *     everything above, AND strong fingerprint agreement. medium within
 *     24h, low after; ambiguity costs a notch. The CAPI forwarder keeps
 *     this tier out of Meta until it has been measured (attr-capi).
 */
export function pickMatch(install: InstallForMatch, clicks: ClickCandidate[]): MatchVerdict | null {
  const byReferrer = referrerMatch(install, clicks);
  if (byReferrer) return byReferrer;
  const installAt = Date.parse(install.first_open_at);
  if (!Number.isFinite(installAt) || !install.ip) return null;
  const fp = installFingerprint(install);
  const range = ipPrefixRange(install.ip);

  const exact: Scored[] = [];
  const network: Scored[] = [];
  // collapse first so a double-loaded tap cannot masquerade as ambiguity
  for (const c of collapseDuplicateTaps(clicks)) {
    if (!c.ip || !timeEligible(c, installAt) || !platformEligible(install, c)) continue;
    const cmp = compareFingerprint(fp, c);
    if (cmp.conflict.length) continue;
    if (c.ip === install.ip) exact.push({ c, cmp });
    else if (range && ipPrefixRange(c.ip)?.key === range.key && strongAgreement(cmp)) network.push({ c, cmp });
  }

  if (exact.length) {
    exact.sort(newestFirst);
    const { c, cmp } = exact[0];
    const age = Math.max(0, installAt - Date.parse(c.clicked_at));
    let confidence: MatchVerdict["confidence"] = age <= HIGH_MS ? "high" : age <= MEDIUM_MS ? "medium" : "low";
    if (exact.length > 1 && confidence !== "low") confidence = notch(confidence);
    return { click: c, confidence, method: "exact_ip", agreed: cmp.agree };
  }
  if (network.length) {
    network.sort(newestFirst);
    const { c, cmp } = network[0];
    const age = Math.max(0, installAt - Date.parse(c.clicked_at));
    let confidence: MatchVerdict["confidence"] = age <= MEDIUM_MS ? "medium" : "low";
    if (network.length > 1) confidence = notch(confidence);
    return { click: c, confidence, method: "network", agreed: cmp.agree };
  }
  return null;
}
