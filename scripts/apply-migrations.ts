/**
 * Apply pending SQL migrations to Supabase via the Management API.
 *
 * Reads .sql files from supabase/migrations/, tracks applied files in a
 * public._migrations table, and POSTs each pending file to
 *   https://api.supabase.com/v1/projects/{ref}/database/query
 *
 * Credentials (loaded from .env.local or scripts/.env.migrate):
 *   SUPABASE_ACCESS_TOKEN     Personal Access Token (sbp_...)
 *   SUPABASE_PROJECT_REF      Project ref (optional — derived from NEXT_PUBLIC_SUPABASE_URL)
 *
 * Usage:
 *   npm run db:migrate              # apply all pending
 *   npm run db:migrate -- --dry-run # list pending without applying
 *   npm run db:migrate -- --status  # show applied vs pending
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

const MIGRATIONS_DIR = path.resolve("supabase/migrations");
const MGMT_API = "https://api.supabase.com/v1";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const STATUS = args.has("--status");

function die(msg: string): never {
  console.error(`\n  ERROR: ${msg}\n`);
  process.exit(1);
}

function deriveProjectRef(): string {
  const explicit = process.env.SUPABASE_PROJECT_REF?.trim();
  if (explicit) return explicit;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const m = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\.(co|in)/i);
  if (!m) {
    die(
      "Could not determine project ref. Set SUPABASE_PROJECT_REF or NEXT_PUBLIC_SUPABASE_URL.",
    );
  }
  return m[1];
}

const PAT = process.env.SUPABASE_ACCESS_TOKEN?.trim() ?? "";
if (!PAT && !STATUS) {
  die(
    "SUPABASE_ACCESS_TOKEN is required. Create a Personal Access Token at https://supabase.com/dashboard/account/tokens and add it to .env.local.",
  );
}

const REF = deriveProjectRef();

interface QueryResponse {
  [key: string]: unknown;
}

async function runSql(sql: string): Promise<unknown> {
  const res = await fetch(`${MGMT_API}/projects/${REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`SQL failed (${res.status}): ${text}`);
  }
  try {
    return JSON.parse(text) as QueryResponse;
  } catch {
    return text;
  }
}

async function ensureTrackingTable(): Promise<void> {
  await runSql(
    `create table if not exists public._migrations (
       filename text primary key,
       applied_at timestamptz not null default now()
     );`,
  );
}

async function fetchApplied(): Promise<Set<string>> {
  const rows = (await runSql(
    "select filename from public._migrations order by filename;",
  )) as Array<{ filename: string }> | unknown;
  if (!Array.isArray(rows)) return new Set();
  return new Set(rows.map((r) => r.filename));
}

function listMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    die(`Migrations dir not found: ${MIGRATIONS_DIR}`);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function markApplied(filename: string): Promise<void> {
  const safe = filename.replace(/'/g, "''");
  await runSql(
    `insert into public._migrations (filename) values ('${safe}') on conflict (filename) do nothing;`,
  );
}

async function applyOne(filename: string): Promise<void> {
  const full = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(full, "utf8");
  process.stdout.write(`  applying ${filename} … `);
  await runSql(sql);
  await markApplied(filename);
  console.log("ok");
}

async function main() {
  console.log(`\n  Supabase migrations — project ${REF}\n`);

  const files = listMigrationFiles();
  if (!files.length) {
    console.log("  no .sql files in supabase/migrations/");
    return;
  }

  let applied = new Set<string>();
  if (PAT) {
    try {
      await ensureTrackingTable();
      applied = await fetchApplied();
    } catch (e) {
      die(
        `Could not reach Supabase Management API: ${(e as Error).message}\n` +
          `  Double-check SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF (${REF}).`,
      );
    }
  }

  const pending = files.filter((f) => !applied.has(f));

  if (STATUS) {
    console.log(`  Applied (${applied.size}):`);
    for (const f of files) if (applied.has(f)) console.log(`    ✓ ${f}`);
    console.log(`\n  Pending (${pending.length}):`);
    for (const f of pending) console.log(`    · ${f}`);
    console.log();
    return;
  }

  if (!pending.length) {
    console.log(`  up to date (${applied.size} applied, 0 pending)\n`);
    return;
  }

  console.log(
    `  ${applied.size} applied, ${pending.length} pending${
      DRY_RUN ? " (dry run)" : ""
    }:`,
  );
  for (const f of pending) console.log(`    · ${f}`);
  console.log();

  if (DRY_RUN) return;

  for (const f of pending) {
    try {
      await applyOne(f);
    } catch (e) {
      console.log();
      die(`while applying ${f}: ${(e as Error).message}`);
    }
  }

  console.log(`\n  applied ${pending.length} migration(s)\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
