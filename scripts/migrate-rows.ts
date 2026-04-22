/**
 * Copies deliveries + saved_captions rows from the old Supabase project to the new one.
 * Rewrites image_url to point at the new project's bucket.
 *
 * Reads credentials from scripts/.env.migrate (gitignored):
 *   OLD_URL, OLD_KEY, DEST_URL, DEST_KEY
 *
 * Run with: npm run migrate-rows
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

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

if (!OLD_URL || !OLD_KEY || !NEW_URL || !NEW_KEY) {
  console.error("Missing OLD_URL/OLD_KEY/DEST_URL/DEST_KEY");
  process.exit(1);
}

const TABLES = ["deliveries", "saved_captions"] as const;

function oldHeaders() {
  return { apikey: OLD_KEY, Authorization: `Bearer ${OLD_KEY}` };
}
function newHeaders(extra: Record<string, string> = {}) {
  return { apikey: NEW_KEY, Authorization: `Bearer ${NEW_KEY}`, ...extra };
}

function rewriteUrls(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  if (typeof out.image_url === "string") {
    out.image_url = out.image_url.replace(OLD_URL, NEW_URL);
  }
  if (typeof out.persona === "string") {
    out.persona = out.persona.toLowerCase();
  }
  return out;
}

async function fetchAll(table: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const res = await fetch(
      `${OLD_URL}/rest/v1/${table}?select=*&order=created_at.asc&limit=${pageSize}&offset=${offset}`,
      { headers: oldHeaders(), cache: "no-store" },
    );
    if (!res.ok) throw new Error(`fetch ${table}: ${res.status} ${await res.text()}`);
    const rows = (await res.json()) as Record<string, unknown>[];
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function upsertRows(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const rewritten = rows.map(rewriteUrls);
  const res = await fetch(`${NEW_URL}/rest/v1/${table}?on_conflict=id`, {
    method: "POST",
    headers: newHeaders({
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(rewritten),
  });
  if (!res.ok) {
    throw new Error(`upsert ${table}: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  for (const table of TABLES) {
    console.log(`\n== ${table} ==`);
    const rows = await fetchAll(table);
    console.log(`  fetched ${rows.length} rows from old`);
    if (rows.length === 0) continue;
    await upsertRows(table, rows);
    console.log(`  ✓ upserted to new (image_url rewritten to ${NEW_URL})`);
  }
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
