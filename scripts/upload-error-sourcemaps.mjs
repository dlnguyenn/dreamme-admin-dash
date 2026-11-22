#!/usr/bin/env node
/**
 * Upload React Native source maps to the DAD's Errors tab, so JavaScript
 * stack lines read as real file names (src/lib/errors/symbolicate.ts).
 *
 * Run it after `npx expo export` (EAS Update) or on the map a native build
 * produced. It finds every *.map under the given paths, reads the map's
 * debug id (`debugId` / `debug_id`, written by the Sentry Metro plugin, i.e.
 * getSentryExpoConfig in metro.config.js), gzips it, and PUTs it to a signed
 * storage URL from POST /api/errors/sourcemaps. Maps without a debug id are
 * keyed by --release, --dist and the bundle file name instead.
 *
 *   DAD_URL=https://dreamme-admin-dash.vercel.app \
 *   DAD_TOKEN=<x-dreamme-secret> \
 *   node scripts/upload-error-sourcemaps.mjs dist --release com.dreamme.app@1.5.9+1.0.95 --dist 1.0.95
 *
 * --dry lists what would be uploaded.
 */
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dry = args.includes("--dry");
const roots = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--dry"));
const DAD = (process.env.DAD_URL ?? "https://dreamme-admin-dash.vercel.app").replace(/\/$/, "");
const TOKEN = process.env.DAD_TOKEN ?? process.env.DREAMME_INGEST_SECRET ?? "";
const release = flag("release") ?? null;
const dist = flag("dist") ?? null;

if (!roots.length) {
  console.error("usage: upload-error-sourcemaps.mjs <dir-or-file>... [--release R] [--dist D] [--dry]");
  process.exit(1);
}
if (!TOKEN && !dry) {
  console.error("Set DAD_TOKEN (the DAD's x-dreamme-secret).");
  process.exit(1);
}

function* walk(p) {
  const st = fs.statSync(p);
  if (st.isFile()) {
    if (p.endsWith(".map")) yield p;
    return;
  }
  for (const e of fs.readdirSync(p)) {
    if (e === "node_modules") continue;
    yield* walk(path.join(p, e));
  }
}

let ok = 0;
let failed = 0;
for (const root of roots) {
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, "utf8");
    let map;
    try {
      map = JSON.parse(text);
    } catch {
      console.warn(`skip ${file}: not JSON`);
      continue;
    }
    const debugId = (map.debugId ?? map.debug_id ?? null)?.toLowerCase() ?? null;
    // "index.android.bundle.map" / "main.jsbundle.map" / "<hash>.hbc.map" -> the bundle's name.
    const bundle = path.basename(file).replace(/\.map$/, "");
    const body = gzipSync(Buffer.from(text, "utf8"));
    const label = `${file} (${(text.length / 1e6).toFixed(1)} MB, ${debugId ? `debug id ${debugId}` : `release ${release ?? "?"}`})`;
    if (!debugId && !release) {
      console.warn(`skip ${label}: no debug id in the map and no --release given`);
      failed += 1;
      continue;
    }
    if (dry) {
      console.log(`would upload ${label}`);
      continue;
    }
    try {
      const res = await fetch(`${DAD}/api/errors/sourcemaps`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-dreamme-secret": TOKEN },
        body: JSON.stringify({ debugId, release, dist, bundle, sizeBytes: text.length }),
      });
      const out = await res.json();
      if (!out.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
      const put = await fetch(out.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/gzip", "x-upsert": "true" }, body });
      if (!put.ok) throw new Error(`upload ${put.status}: ${(await put.text()).slice(0, 200)}`);
      console.log(`uploaded ${label} -> ${out.path}`);
      ok += 1;
    } catch (e) {
      console.error(`failed ${label}: ${e instanceof Error ? e.message : e}`);
      failed += 1;
    }
  }
}
if (!dry) console.log(`${ok} uploaded, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
