#!/usr/bin/env node
/**
 * Packs the readable parts of Dan's vault into the DAD's private Supabase Storage bucket
 * "knowledge-vault", where the Knowledge tab reads them (src/lib/knowledge.ts).
 * Re-run it whenever you want the tab refreshed. Never writes vault content into this repo,
 * which is public.
 *
 *   node scripts/knowledge-snapshot.mjs [vault path]        default: C:/Users/Dan/Documents/SUCCESS IN ALL WAYS
 *   node scripts/knowledge-snapshot.mjs --dry-run            list what would upload
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY)
 * from the environment or this checkout's .env.local. Node 18+, no packages.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const VAULT = path.resolve(args.find((a) => !a.startsWith("--")) || "C:/Users/Dan/Documents/SUCCESS IN ALL WAYS");
const BUCKET = "knowledge-vault";
const INLINE_MAX = 400_000; // small text files ride inside manifest.json, so the index is one download

function loadEnv() {
  for (const name of [".env.local", "../dreamme-admin-dash/.env.local"]) {
    const f = path.join(ROOT, name);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DRY && (!URL_ || !KEY)) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or the service role key (env or .env.local).");
  process.exit(2);
}
if (!fs.existsSync(path.join(VAULT, "wiki", "index.md"))) {
  console.error(`Not a vault: ${VAULT}`);
  process.exit(2);
}

// Same allowlist as isAllowedVaultPath (src/lib/knowledge-shared.ts), plus the data files the server reads.
const RULES = [
  /^wiki\/[A-Za-z0-9._-]+\.md$/,
  /^wiki\/data\/subscription-growth-library[A-Za-z0-9._-]*\/[A-Za-z0-9._-]+\.html$/,
  /^raw-sources\/documents\/artifacts\/\d{4}-\d{2}-\d{2}\/([a-z0-9-]+\.html|index\.json)$/,
  /^raw-sources\/documents\/expert-feeds\/\d{4}\/[A-Za-z0-9._-]+\.(md|json)$/,
  /^raw-sources\/documents\/expert-feeds\/backfill\/[a-z0-9-]+\/([A-Za-z0-9._-]+\.md|posts\.json)$/,
];
const tracked = execFileSync("git", ["-C", VAULT, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
  .split("\0")
  .filter((f) => f && RULES.some((r) => r.test(f)));
const commit = execFileSync("git", ["-C", VAULT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const files = [];
const uploads = [];
for (const rel of tracked) {
  const buf = fs.readFileSync(path.join(VAULT, rel));
  const inline = buf.length <= INLINE_MAX && (/^wiki\/[^/]+\.md$/.test(rel) || /\/\d{4}\/[^/]+\.json$/.test(rel) || rel.endsWith("/index.json"));
  if (inline) files.push({ path: rel, size: buf.length, text: buf.toString("utf8") });
  else {
    files.push({ path: rel, size: buf.length });
    uploads.push({ rel, buf });
  }
}
const manifest = { generatedAt: new Date().toISOString(), commit, files };
const total = files.reduce((n, f) => n + f.size, 0);
console.log(`${files.length} files (${(total / 1e6).toFixed(1)} MB) from vault ${commit.slice(0, 7)}; ${uploads.length} uploaded separately.`);
if (DRY) {
  for (const f of files) console.log(`  ${f.text !== undefined ? "inline" : "upload"}  ${f.path}`);
  process.exit(0);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function ensureBucket() {
  const res = await fetch(`${URL_}/storage/v1/bucket/${BUCKET}`, { headers });
  if (res.ok) {
    const b = await res.json();
    if (b.public) throw new Error(`bucket ${BUCKET} is PUBLIC; refusing to upload private notes into it`);
    return;
  }
  const made = await fetch(`${URL_}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 52428800 }),
  });
  if (!made.ok) throw new Error(`create bucket: ${made.status} ${(await made.text()).slice(0, 200)}`);
  console.log(`Created private bucket ${BUCKET}.`);
}
async function put(rel, body, type) {
  const url = `${URL_}/storage/v1/object/${BUCKET}/${rel.split("/").map(encodeURIComponent).join("/")}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": type, "x-upsert": "true", "Cache-Control": "no-cache" }, body });
    if (res.ok) return;
    if (attempt >= 3) throw new Error(`upload ${rel}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}
const typeOf = (rel) => (rel.endsWith(".html") ? "text/plain; charset=utf-8" : rel.endsWith(".json") ? "application/json" : "text/markdown; charset=utf-8");

await ensureBucket();
let done = 0;
const queue = [...uploads];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let u; (u = queue.shift()); ) {
      await put(u.rel, u.buf, typeOf(u.rel));
      done++;
    }
  }),
);
// The manifest goes last, so the tab never points at files that haven't landed.
await put("manifest.json", JSON.stringify(manifest), "application/json");
console.log(`Uploaded ${done} files + manifest.json to ${BUCKET}. The Knowledge tab shows it within 5 minutes (or press Refresh).`);
