/**
 * Turning one Sentry error event into what the Errors tab stores: a
 * fingerprint (which issue it belongs to), a title and culprit, and a
 * scrubbed copy of the event. Pure: tested in tests/error-tracker.test.ts.
 *
 * Grouping (GROUPING_VERSION 1):
 *  - an SDK-sent `fingerprint` wins (except the "{{ default }}" placeholder);
 *  - otherwise exception type + normalized message (digits, hex, UUIDs, paths,
 *    emails, URLs' query strings stripped). JS frames are left out on purpose:
 *    Hermes production frames are minified and only readable through a source
 *    map, which may not be uploaded, so they'd split issues per release;
 *  - native (cocoa / java / native) events add their newest in-app frame
 *    (see topFrame), because their messages are generic ("App hanging for at
 *    least 2000 ms", "EXC_BAD_ACCESS: KERN_INVALID_ADDRESS at 0x...").
 *
 * Scrubbing is an allowlist: anything not copied below is dropped (request
 * bodies, cookies, extra, user email and IP, local variables). Breadcrumb
 * messages and URLs lose emails and query strings. The app user id (a UUID)
 * is kept so an issue can be tied to a support thread.
 */
import { createHash } from "node:crypto";

export const GROUPING_VERSION = 1;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clip = (s: string | null, n: number): string | null => (s == null ? null : s.length > n ? `${s.slice(0, n)}…` : s);

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Remove things that differ between occurrences of the same bug. */
export function normalizeMessage(s: string): string {
  return s
    .replace(/https?:\/\/[^\s'"<>?#]+(\?[^\s'"<>#]*)?/gi, (m) => m.split("?")[0]) // keep URL path, drop query
    .replace(EMAIL, "<email>")
    .replace(UUID, "<uuid>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
    .replace(/(?:\/[\w.%@+-]+){2,}\/?/g, "<path>") // file paths (iOS containers, Android /data/...)
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/\d+(\.\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

/** Strip emails and query strings from free text we keep (breadcrumbs, values). */
export function scrubText(s: string | null, n = 2000): string | null {
  if (s == null) return null;
  return clip(
    s.replace(/(https?:\/\/[^\s'"<>?#]+)\?[^\s'"<>#]*/gi, "$1").replace(EMAIL, "<email>"),
    n,
  );
}

export interface Frame {
  function: string | null;
  filename: string | null;
  abs_path: string | null;
  module: string | null;
  package: string | null;
  lineno: number | null;
  colno: number | null;
  in_app: boolean | null;
  instruction_addr: string | null;
  symbol: string | null;
  platform: string | null;
  context_line: string | null;
}

function cleanPath(p: string | null): string | null {
  return p == null ? null : clip(p.split("?")[0], 300);
}

export function cleanFrame(f: unknown): Frame {
  const o = obj(f) ?? {};
  return {
    function: clip(str(o.function), 200),
    filename: cleanPath(str(o.filename)),
    abs_path: cleanPath(str(o.abs_path)),
    module: clip(str(o.module), 200),
    package: clip(str(o.package), 300),
    lineno: num(o.lineno),
    colno: num(o.colno),
    in_app: typeof o.in_app === "boolean" ? o.in_app : null,
    instruction_addr: str(o.instruction_addr),
    symbol: clip(str(o.symbol), 200),
    platform: str(o.platform),
    context_line: clip(str(o.context_line), 300),
  };
}

export interface ExceptionValue {
  type: string | null;
  value: string | null;
  module: string | null;
  mechanism: { type: string | null; handled: boolean | null } | null;
  frames: Frame[];
}

function exceptionsOf(event: Json): ExceptionValue[] {
  const ex = obj(event.exception);
  const values = arr(ex ? ex.values : event.exception);
  const threads = arr(obj(event.threads)?.values);
  return values.map((v) => {
    const o = obj(v) ?? {};
    let frames = arr(obj(o.stacktrace)?.frames);
    // Native crashes put the stack on the crashed thread instead.
    if (frames.length === 0 && o.thread_id != null) {
      const t = threads.map(obj).find((t) => t && t.id === o.thread_id);
      frames = arr(obj(t?.stacktrace)?.frames);
    }
    const mech = obj(o.mechanism);
    return {
      type: clip(str(o.type), 200),
      value: scrubText(str(o.value), 2000),
      module: clip(str(o.module), 200),
      mechanism: mech ? { type: str(mech.type), handled: typeof mech.handled === "boolean" ? mech.handled : null } : null,
      frames: frames.slice(-120).map(cleanFrame),
    };
  });
}

const NATIVE = new Set(["cocoa", "java", "native", "objc", "swift", "c", "android"]);

/** A native frame from inside the app bundle (DreamMe.app/DreamMe, DreamMe.app/Frameworks/React.framework/...). */
const inAppBundle = (f: Frame) => !!f.package && /\.app\//.test(f.package);

/**
 * The newest in-app frame (Sentry lists frames oldest first). Like Sentry's
 * own grouping, and checked against real DreamMe issues: the very top frame
 * of a hang is whatever system call was running when it was sampled
 * (objc_msgSend, swift_allocObject), so grouping on it would split one hang
 * into many issues. Native frames count as in-app when they come from the app
 * bundle, which includes React.framework: on the device sentry-cocoa only
 * marks the main executable in-app, Sentry's server widened it the same way.
 */
export function topFrame(frames: Frame[], native = false): Frame | null {
  const named = frames.filter((f) => f.function && f.function !== "<redacted>" && f.function !== "<unknown>");
  const inApp = named.filter((f) => f.in_app || (native && inAppBundle(f)));
  return (inApp.length ? inApp : named).at(-1) ?? frames.at(-1) ?? null;
}

function frameLabel(f: Frame | null): string | null {
  if (!f) return null;
  const fn = f.function ?? f.symbol;
  const file = f.module ?? (f.filename ? f.filename.split("/").pop() ?? null : null) ?? (f.package ? f.package.split("/").pop() ?? null : null);
  if (fn && file) return `${fn}(${file})`;
  return fn ?? file;
}

export interface Summary {
  event_id: string;
  fingerprint: string;
  grouping_version: number;
  platform: string;
  level: string;
  type: string | null;
  value: string | null;
  title: string;
  culprit: string | null;
  mechanism: string | null;
  handled: boolean | null;
  occurred_at: string;
  release: string | null;
  dist: string | null;
  environment: string | null;
  os: string | null;
  device: string | null;
  user_id: string | null;
  user_key: string | null;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function occurredAt(event: Json, now: Date): string {
  const t = event.timestamp;
  let d: Date | null = null;
  if (typeof t === "number") d = new Date(t * 1000);
  else if (typeof t === "string") d = new Date(/^\d+(\.\d+)?$/.test(t) ? Number(t) * 1000 : t);
  if (!d || Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + 5 * 60_000) d = now;
  return d.toISOString();
}

export function summarize(event: Json, now = new Date()): Summary {
  const platform = str(event.platform) ?? "unknown";
  const exceptions = exceptionsOf(event);
  // The outermost exception is the last one in Sentry's list.
  const main = exceptions.at(-1) ?? null;
  const logentry = obj(event.logentry);
  const message = scrubText(str(event.message) ?? str(obj(event.message)?.formatted) ?? str(logentry?.formatted) ?? str(logentry?.message), 2000);

  const type = main?.type ?? null;
  const value = main?.value ?? message;
  const firstLine = (value ?? "").split("\n")[0];
  const title = clip(type ? (firstLine ? `${type}: ${firstLine}` : type) : firstLine || "(no message)", 300) ?? "(no message)";

  const native = NATIVE.has(platform);
  const top = main ? topFrame(main.frames, native) : null;
  const culprit = clip(str(event.culprit) ?? str(event.transaction) ?? frameLabel(top), 300);

  const sdkFingerprint = arr(event.fingerprint).filter((x): x is string => typeof x === "string");
  let key: string;
  if (sdkFingerprint.length && !sdkFingerprint.every((x) => x === "{{ default }}")) {
    key = `fp|${sdkFingerprint.join("|")}`;
  } else {
    const parts = [platform === "javascript" || platform === "node" ? "js" : platform, type ?? "", normalizeMessage(value ?? "")];
    if (native) parts.push(frameLabel(top) ?? "");
    key = `v${GROUPING_VERSION}|${parts.join("|")}`;
  }

  const contexts = obj(event.contexts) ?? {};
  const os = obj(contexts.os);
  const device = obj(contexts.device);
  const app = obj(contexts.app);
  const user = obj(event.user);
  const userId = str(user?.id);
  const deviceHash = str(app?.device_app_hash);
  const userKey = userId ? sha(`u:${userId}`).slice(0, 32) : deviceHash ? sha(`d:${deviceHash}`).slice(0, 32) : null;

  return {
    event_id: (str(event.event_id) ?? sha(`${key}|${now.toISOString()}|${Math.random()}`)).replace(/-/g, "").slice(0, 64),
    fingerprint: sha(key),
    grouping_version: GROUPING_VERSION,
    platform,
    level: str(event.level) ?? "error",
    type,
    value: clip(value, 2000),
    title,
    culprit,
    mechanism: main?.mechanism?.type ?? null,
    handled: main?.mechanism?.handled ?? null,
    occurred_at: occurredAt(event, now),
    release: clip(str(event.release), 200),
    dist: clip(str(event.dist), 100),
    environment: clip(str(event.environment), 100),
    os: [str(os?.name), str(os?.version)].filter(Boolean).join(" ") || null,
    device: str(device?.model) ?? str(device?.family) ?? null,
    user_id: userId && /^[0-9a-f-]{36}$/i.test(userId) ? userId : null,
    user_key: userKey,
  };
}

function pick(o: Json | null, keys: string[]): Json | null {
  if (!o) return null;
  const out: Json = {};
  for (const k of keys) {
    const v = o[k];
    if (v == null) continue;
    if (typeof v === "string") out[k] = clip(v, 300);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

function cleanBreadcrumb(b: unknown): Json | null {
  const o = obj(b);
  if (!o) return null;
  const data = obj(o.data);
  const keptData = data
    ? pick(
        {
          ...data,
          url: typeof data.url === "string" ? data.url.split("?")[0] : data.url,
          to: typeof data.to === "string" ? data.to.split("?")[0] : data.to,
          from: typeof data.from === "string" ? data.from.split("?")[0] : data.from,
        },
        ["url", "method", "status_code", "reason", "to", "from", "screen", "route", "previous_route"],
      )
    : null;
  return {
    timestamp: o.timestamp ?? null,
    type: str(o.type),
    category: clip(str(o.category), 100),
    level: str(o.level),
    message: scrubText(str(o.message), 300),
    data: keptData,
  };
}

/** The copy of the event we keep. Allowlist only. */
export function scrubEvent(event: Json): Json {
  const contexts = obj(event.contexts) ?? {};
  const debugImages = arr(obj(event.debug_meta)?.images)
    .map(obj)
    .filter((i): i is Json => !!i)
    .map((i) => pick(i, ["type", "debug_id", "code_file", "code_id", "image_addr", "image_size", "image_vmaddr", "arch", "uuid"]))
    .filter(Boolean)
    .slice(0, 400);
  const tags = event.tags;
  const tagPairs: [string, string][] = Array.isArray(tags)
    ? (tags as unknown[]).map((t) => (Array.isArray(t) ? [String(t[0]), String(t[1])] : ["", ""]) as [string, string])
    : Object.entries(obj(tags) ?? {}).map(([k, v]) => [k, String(v)] as [string, string]);
  const user = obj(event.user);
  const userId = str(user?.id);
  return {
    event_id: str(event.event_id),
    timestamp: event.timestamp ?? null,
    platform: str(event.platform),
    level: str(event.level),
    release: str(event.release),
    dist: str(event.dist),
    environment: str(event.environment),
    message: scrubText(str(event.message) ?? str(obj(event.logentry)?.formatted), 2000),
    exceptions: exceptionsOf(event),
    breadcrumbs: arr(obj(event.breadcrumbs)?.values ?? event.breadcrumbs).slice(-40).map(cleanBreadcrumb).filter(Boolean),
    contexts: {
      os: pick(obj(contexts.os), ["name", "version", "build"]),
      device: pick(obj(contexts.device), ["family", "model", "model_id", "arch", "simulator", "memory_size", "free_memory", "battery_level", "charging", "thermal_state", "locale"]),
      app: {
        ...(pick(obj(contexts.app), ["app_version", "app_build", "build_type", "in_foreground", "app_start_time", "app_memory"]) ?? {}),
        view_names: arr(obj(contexts.app)?.view_names).filter((v) => typeof v === "string").slice(0, 10),
      },
      ota_updates: pick(obj(contexts.ota_updates), ["update_id", "channel", "runtime_version", "is_embedded_launch", "is_emergency_launch"]),
      react_native: pick(obj(contexts.react_native_context), ["js_engine", "hermes_version", "react_native_version", "fabric", "expo"]),
    },
    tags: Object.fromEntries(
      tagPairs.filter(([k]) => k && k !== "user" && !/email|ip|token|secret|password/i.test(k)).slice(0, 60).map(([k, v]) => [clip(k, 64), clip(v, 200)]),
    ),
    user: userId && /^[0-9a-f-]{36}$/i.test(userId) ? { id: userId } : null,
    sdk: pick(obj(event.sdk), ["name", "version"]),
    debug_images: debugImages,
  };
}
