/**
 * Sentry envelope parsing (https://develop.sentry.dev/sdk/envelopes/), for
 * the DAD's own error tracker. Pure and server-only: no network, no DB.
 *
 * An envelope is newline-separated: one JSON header line, then items. Each
 * item is a JSON header line and a payload. When the item header has a
 * `length`, the payload is exactly that many bytes (it may contain newlines
 * or be binary, e.g. attachments); otherwise it runs to the next newline.
 * The React Native SDK hands envelopes to the native SDKs (sentry-cocoa,
 * sentry-android), which may gzip the body and authenticate with an
 * X-Sentry-Auth header instead of the sentry_key query parameter.
 */
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";

/** Compressed request bodies bigger than this are refused (413). */
export const MAX_BODY_BYTES = 1_000_000;
/** And after decompression. */
export const MAX_DECODED_BYTES = 8_000_000;

export interface EnvelopeItem {
  type: string;
  header: Record<string, unknown>;
  payload: Buffer;
}

export interface Envelope {
  header: Record<string, unknown>;
  items: EnvelopeItem[];
}

export class EnvelopeError extends Error {}

export function decodeBody(raw: Buffer, contentEncoding: string | null): Buffer {
  const enc = (contentEncoding ?? "").trim().toLowerCase();
  const opts = { maxOutputLength: MAX_DECODED_BYTES };
  try {
    if (enc === "gzip" || enc === "x-gzip") return gunzipSync(raw, opts);
    if (enc === "deflate") return inflateSync(raw, opts);
    if (enc === "br") return brotliDecompressSync(raw, opts);
  } catch (e) {
    throw new EnvelopeError(`could not decode ${enc} body: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Some clients gzip without saying so: sniff the gzip magic bytes.
  if (raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    try {
      return gunzipSync(raw, opts);
    } catch {
      /* fall through: treat as plain */
    }
  }
  return raw;
}

function readLine(buf: Buffer, start: number): { line: Buffer; next: number } {
  const nl = buf.indexOf(0x0a, start);
  if (nl === -1) return { line: buf.subarray(start), next: buf.length };
  return { line: buf.subarray(start, nl), next: nl + 1 };
}

function parseJsonLine(line: Buffer, what: string): Record<string, unknown> {
  const text = line.toString("utf8").replace(/\r$/, "");
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v as Record<string, unknown>;
  } catch (e) {
    throw new EnvelopeError(`bad ${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function parseEnvelope(buf: Buffer): Envelope {
  let pos = 0;
  const first = readLine(buf, pos);
  const header = parseJsonLine(first.line, "envelope header");
  pos = first.next;
  const items: EnvelopeItem[] = [];
  while (pos < buf.length) {
    const h = readLine(buf, pos);
    pos = h.next;
    if (h.line.length === 0 || (h.line.length === 1 && h.line[0] === 0x0d)) continue; // blank line between items
    const itemHeader = parseJsonLine(h.line, "item header");
    const len = typeof itemHeader.length === "number" ? itemHeader.length : null;
    let payload: Buffer;
    if (len != null) {
      if (len < 0 || pos + len > buf.length) throw new EnvelopeError("item length runs past the end of the envelope");
      payload = buf.subarray(pos, pos + len);
      pos += len;
      // A newline after a length-delimited payload is optional.
      if (buf[pos] === 0x0a) pos += 1;
    } else {
      const p = readLine(buf, pos);
      payload = p.line;
      pos = p.next;
    }
    items.push({ type: String(itemHeader.type ?? ""), header: itemHeader, payload });
  }
  return { header, items };
}

/**
 * The public key the request was signed with: `sentry_key` in the query
 * string (browser/JS transport), the X-Sentry-Auth header (native SDKs), or
 * the `dsn` in the envelope header.
 */
export function publicKeyFrom(url: URL, authHeader: string | null, envelopeHeader?: Record<string, unknown>): string | null {
  const q = url.searchParams.get("sentry_key");
  if (q) return q;
  if (authHeader) {
    const m = authHeader.match(/sentry_key\s*=\s*([^,\s]+)/i);
    if (m) return m[1];
  }
  const dsn = envelopeHeader?.dsn;
  if (typeof dsn === "string") {
    try {
      return new URL(dsn).username || null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Envelope item type -> the SDK's rate-limit data category. */
const ITEM_CATEGORY: Record<string, string> = {
  transaction: "transaction",
  span: "span",
  profile: "profile",
  profile_chunk: "profile_chunk",
  replay_event: "replay",
  replay_recording: "replay",
  replay_video: "replay",
  session: "session",
  sessions: "session",
  attachment: "attachment",
  log: "log_item",
  statsd: "metric",
  metric: "metric",
  trace_metric: "metric",
};

/** Item types we store. Everything else is acknowledged and dropped. */
export const STORED_ITEM_TYPES = new Set(["event"]);

/**
 * Sent on every response: tells the SDK to stop sending what we drop for a
 * day (it re-learns on the next response after that). Format, from
 * @sentry/core updateRateLimits: <retry_after>:<categories>:<scope>:<reason>.
 * Only a backstop: the limit resets on each app launch, so the app itself
 * should turn tracing, profiling and replay off.
 */
export const DROPPED_CATEGORIES = Array.from(new Set(Object.values(ITEM_CATEGORY)));
export const RATE_LIMIT_HEADER = `86400:${DROPPED_CATEGORIES.join(";")}:project:not_stored`;

export function categoryOf(itemType: string): string | null {
  return ITEM_CATEGORY[itemType] ?? null;
}
