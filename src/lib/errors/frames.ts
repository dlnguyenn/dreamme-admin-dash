/**
 * Shared by the server (symbolicate.ts) and the Errors drawer, so it has no
 * imports beyond types: the drawer must not pull the source-map library or
 * node:crypto into the page bundle.
 */
import type { Frame } from "./event";

/**
 * JS bundle frames: the ones a source map can fix. First choice is a frame
 * whose path is a sourcemap debug image's code_file: @sentry/core fills those
 * images after the React Native frame rewrite, so they match exactly
 * (app:///main.jsbundle on iOS, app:///index.android.bundle on Android, OTA
 * bundles included: the RN SDK renames Expo's hashed bundle files to these).
 * The extension check covers events without debug ids.
 */
export function isBundleFrame(f: Frame, images: Record<string, unknown>[] = []): boolean {
  const p = (f.abs_path ?? f.filename ?? "").split("?")[0];
  if (!p || p === "native" || p === "[native code]") return false;
  if (images.some((i) => i.type === "sourcemap" && i.code_file === p)) return true;
  return /\.(jsbundle|bundle|hbc|js)$/i.test(p) && !/node_modules\//.test(p);
}

