/**
 * Copies every object from the old Supabase storage bucket to the new one.
 *
 * Create scripts/.env.migrate (gitignored) with:
 *   OLD_URL=https://old-project.supabase.co
 *   OLD_KEY=eyJ...
 *   DEST_URL=https://new-project.supabase.co   # omit to use local from .env.local
 *   DEST_KEY=eyJ...                            # omit to use local from .env.local
 *
 * Then run: npm run migrate-bucket
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// Load scripts/.env.migrate if present (not committed, never logged)
const migrateEnvPath = path.resolve("scripts/.env.migrate");
if (fs.existsSync(migrateEnvPath)) {
  for (const line of fs.readFileSync(migrateEnvPath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const OLD_URL = process.env.OLD_URL ?? "";
const OLD_KEY = process.env.OLD_KEY ?? "";
const NEW_URL = process.env.DEST_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const NEW_KEY = process.env.DEST_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_BUCKET ?? "dreamme-internal-images";

if (!OLD_URL || !OLD_KEY) {
  console.error("OLD_URL and OLD_KEY must be set");
  process.exit(1);
}
if (!NEW_URL || !NEW_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  process.exit(1);
}

function oldHeaders() {
  return { apikey: OLD_KEY, Authorization: `Bearer ${OLD_KEY}` };
}
function newHeaders(extra: Record<string, string> = {}) {
  return { apikey: NEW_KEY, Authorization: `Bearer ${NEW_KEY}`, ...extra };
}

async function listAll(prefix = ""): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const res = await fetch(`${OLD_URL}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: { ...oldHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`list failed: ${res.status} ${await res.text()}`);
    const items = (await res.json()) as Array<{ name: string; id: string | null }>;
    if (!items.length) break;
    for (const item of items) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) {
        // folder — recurse
        const sub = await listAll(fullPath);
        paths.push(...sub);
      } else {
        paths.push(fullPath);
      }
    }
    if (items.length < limit) break;
    offset += limit;
  }
  return paths;
}

async function copyOne(filePath: string, idx: number, total: number): Promise<void> {
  const downloadRes = await fetch(
    `${OLD_URL}/storage/v1/object/${BUCKET}/${filePath}`,
    { headers: oldHeaders() },
  );
  if (!downloadRes.ok) {
    throw new Error(`download failed [${filePath}]: ${downloadRes.status}`);
  }
  const contentType = downloadRes.headers.get("content-type") ?? "application/octet-stream";
  const buf = Buffer.from(await downloadRes.arrayBuffer());

  const uploadRes = await fetch(
    `${NEW_URL}/storage/v1/object/${BUCKET}/${filePath}`,
    {
      method: "POST",
      headers: newHeaders({ "Content-Type": contentType, "x-upsert": "true" }),
      body: buf,
    },
  );
  if (!uploadRes.ok) {
    throw new Error(`upload failed [${filePath}]: ${uploadRes.status} ${await uploadRes.text()}`);
  }
  console.log(`[${idx + 1}/${total}] ✓ ${filePath} (${(buf.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  console.log(`Listing objects in ${BUCKET} from ${OLD_URL} …`);
  const paths = await listAll();
  console.log(`Found ${paths.length} files. Copying to ${NEW_URL} …\n`);

  if (paths.length === 0) {
    console.log("Nothing to copy.");
    return;
  }

  let copied = 0;
  const errors: string[] = [];
  for (let i = 0; i < paths.length; i++) {
    try {
      await copyOne(paths[i], i, paths.length);
      copied++;
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(msg);
      console.error(`  ✗ ${msg}`);
    }
  }

  console.log(`\nDone. ${copied}/${paths.length} copied.`);
  if (errors.length) {
    console.error(`\n${errors.length} error(s):`);
    errors.forEach((e) => console.error(" ", e));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
