/**
 * Android install referrers — the deterministic evidence the matcher reads
 * before it falls back to IP and fingerprint (attr-match pickMatch).
 *
 * Two referrers arrive in the install ping from Android builds whose SDK
 * reads them (lib/attribution/installAttribution.ts in the app repo):
 *
 *   install_referrer        Google Play Install Referrer: the `referrer=`
 *                           string of the click that opened the Play listing,
 *                           plus click and install-begin timestamps (seconds).
 *                           Our own ad link (/l) puts `dm_click=<click_id>`
 *                           in it; a Meta app ad puts an encrypted
 *                           `utm_content` in it.
 *   meta_install_referrer   Meta Install Referrer: what the Facebook,
 *                           Instagram or Facebook Lite app answers from its
 *                           InstallReferrerProvider. Same encrypted payload,
 *                           and it also covers installs that followed a VIEW
 *                           or a click in an earlier session, which Play
 *                           never sees. `is_ct` 1 = click, 0 = view;
 *                           `actual_timestamp` is in seconds.
 *
 * The encrypted payload is `{ data, nonce }` (both hex) under
 * `utm_content.source`. It decrypts with AES-256-GCM and the "Install
 * Referrer Decryption Key" of the Meta app (App settings > Basic > Android),
 * read here from META_INSTALL_REFERRER_KEY (64 hex characters). Docs:
 * developers.facebook.com/docs/app-ads/meta-install-referrer and
 * /docs/app-ads/install-referrer.
 *
 * Everything in this file is pure: the key is an argument, never read from
 * the environment here, so tests can pin every branch.
 */

import { createDecipheriv } from "node:crypto";
import { z } from "zod";

/** Vercel env var holding the Meta app's Install Referrer Decryption Key. */
export const META_REFERRER_KEY_ENV = "META_INSTALL_REFERRER_KEY";

// ── payload shapes (the install ping) ──────────────────────────────────

/** Unix SECONDS, as both Play and Meta report them. 0 means "unknown". */
const seconds = z.number().int().min(0).max(4_102_444_800);

export const PlayReferrerBody = z.object({
  referrer: z.string().min(1).max(10_000),
  click_ts: seconds.optional(),
  install_begin_ts: seconds.optional(),
  click_server_ts: seconds.optional(),
  install_begin_server_ts: seconds.optional(),
  install_version: z.string().max(64).optional(),
  google_play_instant: z.boolean().optional(),
});
export type PlayReferrerT = z.infer<typeof PlayReferrerBody>;

export const META_REFERRER_APPS = ["facebook", "instagram", "facebook_lite"] as const;

export const MetaReferrerBody = z.object({
  /** The provider's `install_referrer` column, exactly as returned. */
  install_referrer: z.string().min(1).max(10_000),
  actual_timestamp: seconds.optional(),
  is_ct: z.number().int().min(0).max(1).optional(),
  /** Which app's provider answered. */
  source: z.enum(META_REFERRER_APPS).optional(),
});
export type MetaReferrerT = z.infer<typeof MetaReferrerBody>;

export interface ReferrerFields {
  install_referrer?: PlayReferrerT;
  meta_install_referrer?: MetaReferrerT;
}

/** Read the two referrer objects out of a stored `raw` body (the daily
 *  re-sweep works from `raw`, which exists whether or not the extracted
 *  columns have been migrated in). A malformed object reads as absent. */
export function referrerFieldsFrom(raw: unknown): ReferrerFields {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const play = PlayReferrerBody.safeParse(r.install_referrer);
  const meta = MetaReferrerBody.safeParse(r.meta_install_referrer);
  return {
    ...(play.success ? { install_referrer: play.data } : {}),
    ...(meta.success ? { meta_install_referrer: meta.data } : {}),
  };
}

// ── our own click id in the Play referrer ──────────────────────────────

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`, "i");
/** The key may still be percent-encoded if a browser encoded the link twice. */
const DM_CLICK_RE = new RegExp(`(?:^|[&?]|%26)dm_click(?:=|%3D)(${UUID})(?![0-9a-f-])`, "i");

/** What /l appends to the Play URL for Android taps. The referrer string
 *  comes back from Play decoded once: `utm_source=dreamme_link&dm_click=…`. */
export function playReferrerParam(clickId: string): string | null {
  return UUID_RE.test(clickId) ? `utm_source=dreamme_link&dm_click=${clickId.toLowerCase()}` : null;
}

/** The attr_clicks id a Play referrer carries, or null. */
export function referrerClickId(referrer: string | null | undefined): string | null {
  const m = referrer ? DM_CLICK_RE.exec(referrer) : null;
  return m ? m[1].toLowerCase() : null;
}

// ── Meta's encrypted payload ───────────────────────────────────────────

export interface EncryptedSource {
  data: string;
  nonce: string;
}

const hexField = (s: string, key: string): string | null => {
  // quotes may be absent or backslash-escaped (JSON inside JSON), and Meta's
  // own example separates with `=` in places
  const m = s.match(new RegExp(`(?:^|[^A-Za-z0-9_])${key}\\\\?["']?\\s*[:=]\\s*\\\\?["']?([0-9a-fA-F]+)`));
  return m && m[1].length % 2 === 0 ? m[1] : null;
};

/** Find `utm_content.source.{data,nonce}` in a referrer, whatever wraps it:
 *  a JSON object (the Meta provider), a query string whose utm_content is
 *  JSON (Play), percent-encoded or not. */
export function encryptedSource(referrer: string | null | undefined): EncryptedSource | null {
  if (!referrer) return null;
  let s = referrer;
  for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(s); i++) {
    try {
      s = decodeURIComponent(s);
    } catch {
      break;
    }
  }
  const data = hexField(s, "data");
  const nonce = hexField(s, "nonce");
  return data && nonce ? { data, nonce } : null;
}

const hexBytes = (hex: string): Buffer | null =>
  /^(?:[0-9a-fA-F]{2})+$/.test(hex) ? Buffer.from(hex, "hex") : null;

/** Meta ad ids run to 18 digits, past what a JSON number holds exactly.
 *  Quote any long bare integer before parsing so an id is never rounded. */
function parseJsonObject(bytes: Buffer): Record<string, unknown> | null {
  const text = bytes.toString("utf8").trim();
  if (!text.startsWith("{")) return null;
  for (const candidate of [text.replace(/([:[,]\s*)(\d{16,})(?=\s*[,}\]])/g, '$1"$2"'), text]) {
    try {
      const v: unknown = JSON.parse(candidate);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // try the next spelling
    }
  }
  return null;
}

const GCM_TAG_BYTES = 16;

/**
 * AES-256-GCM, libsodium's combined layout: ciphertext followed by a
 * 16-byte tag. Meta's guide says in one place that the tag is trimmed and
 * in another that it is appended, so both are accepted: first the checked
 * decrypt (tag = last 16 bytes), then an unchecked one (GCM is CTR
 * underneath), with or without 16 trailing bytes dropped. An unchecked
 * result is only kept if it parses as a JSON object, which a wrong key
 * cannot produce.
 */
export function decryptMetaReferrer(
  source: EncryptedSource,
  keyHex: string | null | undefined,
): { payload: Record<string, unknown>; authenticated: boolean } | null {
  const key = hexBytes((keyHex ?? "").trim());
  const data = hexBytes(source.data);
  const nonce = hexBytes(source.nonce);
  if (!key || key.length !== 32 || !data || !nonce) return null;

  if (data.length > GCM_TAG_BYTES) {
    try {
      const d = createDecipheriv("aes-256-gcm", key, nonce);
      d.setAuthTag(data.subarray(data.length - GCM_TAG_BYTES));
      const plain = Buffer.concat([d.update(data.subarray(0, data.length - GCM_TAG_BYTES)), d.final()]);
      const payload = parseJsonObject(plain);
      if (payload) return { payload, authenticated: true };
    } catch {
      // wrong key, or no tag on the end: try unchecked below
    }
  }
  try {
    const plain = createDecipheriv("aes-256-gcm", key, nonce).update(data);
    for (const candidate of [plain, plain.subarray(0, Math.max(0, plain.length - GCM_TAG_BYTES))]) {
      const payload = parseJsonObject(candidate);
      if (payload) return { payload, authenticated: false };
    }
  } catch {
    // unusable nonce length
  }
  return null;
}

/** The ad a decrypted Meta referrer names. */
export interface MetaAdIds {
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  account_id: string | null;
}

const idOf = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" && Number.isSafeInteger(v) ? String(v) : "";
  return s && s.length <= 64 && !s.includes("{") ? s : null;
};

/**
 * Meta's payload uses its legacy object names, one level off from Ads
 * Manager: `campaign_group_*` is the CAMPAIGN, `campaign_*` is the AD SET,
 * `adgroup_*` is the AD (`ad_id` repeats it). AppsFlyer and Adjust both
 * document the same mapping. Check it against Ads Manager on the first
 * real row; `ref_decoded` keeps the payload as Meta sent it either way.
 */
export function metaAdIds(payload: Record<string, unknown>): MetaAdIds {
  return {
    campaign_id: idOf(payload.campaign_group_id),
    adset_id: idOf(payload.campaign_id),
    ad_id: idOf(payload.adgroup_id) ?? idOf(payload.ad_id),
    account_id: idOf(payload.account_id)?.replace(/^act_/, "") ?? null,
  };
}

// ── what the ingest stores and what the matcher reads ──────────────────

/** Extracted columns on attr_installs (migration 20261105_attr_install_referrers).
 *  `raw` keeps the referrers exactly as the app sent them. */
export interface ReferrerColumns {
  /** Play referrer string. */
  install_referrer: string | null;
  referrer_click_at: string | null;
  install_begin_at: string | null;
  /** attr_clicks.click_id carried by the Play referrer (our /l link). */
  referrer_click_id: string | null;
  /** facebook | instagram | facebook_lite: whose provider answered. */
  meta_referrer_app: string | null;
  meta_referrer_at: string | null;
  /** true = the install followed a click, false = a view. */
  meta_referrer_is_ct: boolean | null;
  /** Which referrer the ref_* ids came from. */
  ref_source: "play_referrer" | "meta_referrer" | null;
  ref_campaign_id: string | null;
  ref_adset_id: string | null;
  ref_ad_id: string | null;
  ref_account_id: string | null;
  /** Decrypted payloads as Meta sent them: { play?: {...}, meta?: {...} }. */
  ref_decoded: Record<string, unknown> | null;
}

export const REFERRER_COLUMNS = [
  "install_referrer",
  "referrer_click_at",
  "install_begin_at",
  "referrer_click_id",
  "meta_referrer_app",
  "meta_referrer_at",
  "meta_referrer_is_ct",
  "ref_source",
  "ref_campaign_id",
  "ref_adset_id",
  "ref_ad_id",
  "ref_account_id",
  "ref_decoded",
] as const satisfies ReadonlyArray<keyof ReferrerColumns>;

/** The part of ReferrerColumns that needs the decryption key. The daily
 *  re-sweep writes these when the key was added after the install arrived. */
export const REFERRER_KEYED_COLUMNS = [
  "ref_source",
  "ref_campaign_id",
  "ref_adset_id",
  "ref_ad_id",
  "ref_account_id",
  "ref_decoded",
] as const satisfies ReadonlyArray<keyof ReferrerColumns>;

/** Deterministic evidence for pickMatch, strongest first. */
export interface ReferrerEvidence {
  /** Our own click id from the Play referrer. */
  play_click_id: string | null;
  /** Ad named by a Meta payload inside the PLAY referrer: a click that went
   *  through the Play listing. */
  play_meta: MetaAdIds | null;
  /** Ad named by the META referrer: clicks and views, including ones Play
   *  never saw. */
  meta: MetaAdIds | null;
}

const isoFromSeconds = (s: number | undefined): string | null =>
  s && s > 0 ? new Date(s * 1000).toISOString() : null;

const decodeIds = (
  referrer: string | undefined,
  keyHex: string | null | undefined,
): { payload: Record<string, unknown>; ids: MetaAdIds } | null => {
  const source = encryptedSource(referrer);
  const dec = source ? decryptMetaReferrer(source, keyHex) : null;
  if (!dec) return null;
  const ids = metaAdIds(dec.payload);
  // a payload that does not name the campaign is not evidence
  return ids.campaign_id ? { payload: dec.payload, ids } : null;
};

/**
 * Turn the two referrers into stored columns and matcher evidence. With no
 * key (or the wrong one) the plain parts still extract (the Play string,
 * timestamps, our click id) and the Meta ids stay null until a later
 * re-sweep has the key.
 */
export function resolveReferrers(
  fields: ReferrerFields,
  keyHex: string | null | undefined,
): { columns: ReferrerColumns; evidence: ReferrerEvidence } {
  const play = fields.install_referrer;
  const meta = fields.meta_install_referrer;
  const playMeta = decodeIds(play?.referrer, keyHex);
  const metaOwn = decodeIds(meta?.install_referrer, keyHex);
  // Play's referrer is the click that opened the store page for this very
  // install, so it outranks Meta's own provider (which may report a view)
  const named = playMeta ?? metaOwn;
  const decoded: Record<string, unknown> = {
    ...(playMeta ? { play: playMeta.payload } : {}),
    ...(metaOwn ? { meta: metaOwn.payload } : {}),
  };
  const clickId = referrerClickId(play?.referrer);

  return {
    columns: {
      install_referrer: play?.referrer ?? null,
      referrer_click_at: isoFromSeconds(play?.click_ts),
      install_begin_at: isoFromSeconds(play?.install_begin_ts),
      referrer_click_id: clickId,
      meta_referrer_app: meta?.source ?? null,
      meta_referrer_at: isoFromSeconds(meta?.actual_timestamp),
      meta_referrer_is_ct: meta?.is_ct === undefined ? null : meta.is_ct === 1,
      ref_source: playMeta ? "play_referrer" : metaOwn ? "meta_referrer" : null,
      ref_campaign_id: named?.ids.campaign_id ?? null,
      ref_adset_id: named?.ids.adset_id ?? null,
      ref_ad_id: named?.ids.ad_id ?? null,
      ref_account_id: named?.ids.account_id ?? null,
      ref_decoded: playMeta || metaOwn ? decoded : null,
    },
    evidence: {
      play_click_id: clickId,
      play_meta: playMeta?.ids ?? null,
      meta: metaOwn?.ids ?? null,
    },
  };
}

/** True when the evidence can decide a match on its own. */
export function hasReferrerEvidence(e: ReferrerEvidence | null | undefined): boolean {
  return !!(e && (e.play_click_id || e.play_meta?.campaign_id || e.meta?.campaign_id));
}
