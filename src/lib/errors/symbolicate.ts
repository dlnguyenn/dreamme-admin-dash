/**
 * Source-map symbolication for JS (Hermes) frames, done when someone opens an
 * event rather than at ingest, so ingest never depends on a map being there.
 * The resolved frames are written back to err_events.symbolicated, so each
 * map is downloaded and parsed once per event.
 *
 * Which map: the event's debug_meta images of type "sourcemap" carry a
 * debug_id per bundle (code_file = the frame's abs_path, e.g.
 * app:///main.jsbundle) when the bundle was built with debug ids (the Sentry
 * Metro plugin, getSentryExpoConfig). Without one, the release + dist +
 * bundle file name is used.
 *
 * Positions: Sentry frames are 1-based line and column; trace-mapping wants a
 * 1-based line and 0-based column. For Hermes bytecode the "column" is the
 * bytecode offset in line 1, which the composed Hermes map indexes the same
 * way. Checked against a synthetic map only, not yet against a device stack
 * (see docs/error-tracker.md).
 */
import { TraceMap, originalPositionFor, sourceContentFor } from "@jridgewell/trace-mapping";
import type { ExceptionValue, Frame } from "./event";

export interface MapKey {
  debugId: string | null;
  bundle: string | null;
}

export { isBundleFrame } from "./frames";
import { isBundleFrame } from "./frames";

export function bundleName(f: Frame): string | null {
  const p = f.abs_path ?? f.filename;
  return p ? (p.split("?")[0].split("/").pop() ?? null) : null;
}

export function mapKeyFor(f: Frame, images: Record<string, unknown>[]): MapKey {
  const path = f.abs_path ?? f.filename;
  const name = bundleName(f);
  const img = images.find(
    (i) => i.type === "sourcemap" && typeof i.debug_id === "string" && (i.code_file === path || (name && typeof i.code_file === "string" && i.code_file.endsWith(`/${name}`))),
  );
  return { debugId: (img?.debug_id as string | undefined) ?? null, bundle: name };
}

/** Strip Metro / webpack prefixes so paths read like the repo. */
export function cleanSource(source: string): string {
  return source
    .replace(/^webpack:\/\/\/?/, "")
    .replace(/^app:\/\/\/?/, "")
    .replace(/^.*?\/(node_modules\/)/, "$1")
    .replace(/^(\.\.\/)+/, "")
    .replace(/^\/?(Users|home|private|var)\/[^]*?\/(app|lib|components|utils|hooks|contexts|screens|src)\//, "$2/");
}

export interface ResolvedFrame extends Frame {
  resolved: boolean;
}

export function resolveFrame(f: Frame, map: TraceMap | null): ResolvedFrame {
  if (!map || f.lineno == null || f.colno == null) return { ...f, resolved: false };
  const pos = originalPositionFor(map, { line: f.lineno, column: Math.max(0, f.colno - 1) });
  if (!pos.source || pos.line == null) return { ...f, resolved: false };
  const source = cleanSource(pos.source);
  let contextLine: string | null = null;
  try {
    const content = sourceContentFor(map, pos.source);
    if (content) contextLine = content.split("\n")[pos.line - 1]?.trim().slice(0, 300) ?? null;
  } catch {
    contextLine = null;
  }
  return {
    ...f,
    function: pos.name ?? f.function,
    filename: source,
    abs_path: source,
    module: null,
    lineno: pos.line,
    colno: (pos.column ?? 0) + 1,
    in_app: !/node_modules\//.test(source),
    context_line: contextLine ?? f.context_line,
    resolved: true,
  };
}

/**
 * Resolve every bundle frame. getMap returns the parsed map for a key, or
 * null when none was uploaded. Returns null when nothing could be resolved.
 */
export async function symbolicateExceptions(
  exceptions: ExceptionValue[],
  images: Record<string, unknown>[],
  getMap: (key: MapKey) => Promise<TraceMap | null>,
): Promise<{ exceptions: (Omit<ExceptionValue, "frames"> & { frames: ResolvedFrame[] })[]; resolvedFrames: number; missing: string[] } | null> {
  const cache = new Map<string, TraceMap | null>();
  const missing = new Set<string>();
  let resolvedFrames = 0;
  const out = [];
  for (const ex of exceptions) {
    const frames: ResolvedFrame[] = [];
    for (const f of ex.frames) {
      if (!isBundleFrame(f, images)) {
        frames.push({ ...f, resolved: false });
        continue;
      }
      const key = mapKeyFor(f, images);
      const id = key.debugId ?? `bundle:${key.bundle}`;
      if (!cache.has(id)) cache.set(id, await getMap(key).catch(() => null));
      const map = cache.get(id) ?? null;
      if (!map) missing.add(key.debugId ? `debug id ${key.debugId}` : `bundle ${key.bundle}`);
      const r = resolveFrame(f, map);
      if (r.resolved) resolvedFrames += 1;
      frames.push(r);
    }
    out.push({ ...ex, frames });
  }
  if (resolvedFrames === 0) return null;
  return { exceptions: out, resolvedFrames, missing: Array.from(missing) };
}
