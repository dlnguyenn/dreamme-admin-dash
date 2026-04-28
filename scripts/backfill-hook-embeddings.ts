/**
 * Backfill embeddings + family_id for existing rows in tiktok_posts and
 * generated_hooks. Run once after applying migration 0011.
 *
 * Usage:
 *   tsx scripts/backfill-hook-embeddings.ts
 *   tsx scripts/backfill-hook-embeddings.ts --dry-run
 *
 * Reads: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY.
 * Idempotent: only processes rows where embedding IS NULL.
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { embed, toPgVector, voyageConfigured } from "../src/lib/voyage";
import {
  attachOrCreate,
  createPostgrestFamilyStore,
  type FamilyRow,
} from "../src/lib/families";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH = 64;

function die(msg: string): never {
  console.error(`\n  ERROR: ${msg}\n`);
  process.exit(1);
}

if (!SUPABASE_URL || !SERVICE_ROLE) die("Supabase env vars not set");
if (!voyageConfigured()) die("VOYAGE_API_KEY not set");

const headers = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  "Content-Type": "application/json",
};

interface Row {
  id: string;
  text: string;
  category: string | null;
}

async function fetchUnembeddedPosts(): Promise<Row[]> {
  const url = `${SUPABASE_URL}/rest/v1/tiktok_posts?select=id,first_slide_text,category&embedding=is.null&first_slide_text=not.is.null&limit=10000`;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) die(`tiktok_posts fetch failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{
    id: string;
    first_slide_text: string | null;
    category: string | null;
  }>;
  return rows
    .filter((r) => r.first_slide_text && r.first_slide_text.trim())
    .map((r) => ({
      id: r.id,
      text: r.first_slide_text as string,
      category: r.category,
    }));
}

async function fetchUnembeddedGenerated(): Promise<Row[]> {
  const url = `${SUPABASE_URL}/rest/v1/generated_hooks?select=id,hook_text,category&embedding=is.null&limit=10000`;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) die(`generated_hooks fetch failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{
    id: string;
    hook_text: string;
    category: string | null;
  }>;
  return rows
    .filter((r) => r.hook_text && r.hook_text.trim())
    .map((r) => ({ id: r.id, text: r.hook_text, category: r.category }));
}

async function patchRow(
  table: "tiktok_posts" | "generated_hooks",
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  if (DRY_RUN) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`${table} patch failed for ${id}: ${res.status} ${await res.text()}`);
}

async function processTable(
  table: "tiktok_posts" | "generated_hooks",
  rows: Row[],
  familyRoster: FamilyRow[],
  familyStore: ReturnType<typeof createPostgrestFamilyStore>,
): Promise<{ embedded: number; attached: number; created: number; failed: number }> {
  let embedded = 0;
  let attached = 0;
  let created = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    let vectors: number[][];
    try {
      vectors = await embed(slice.map((r) => r.text));
    } catch (e) {
      console.error(`embed batch failed at offset ${i}:`, e);
      failed += slice.length;
      continue;
    }

    for (let j = 0; j < slice.length; j++) {
      const row = slice[j];
      const v = vectors[j];
      if (!v) {
        failed++;
        continue;
      }
      embedded++;

      let familyId: string | null = null;
      try {
        const attach = await attachOrCreate(familyStore, familyRoster, {
          embedding: v,
          exemplar_text: row.text,
          category: row.category,
          ...(table === "tiktok_posts"
            ? { exemplar_post_id: row.id }
            : { exemplar_generated_id: row.id }),
        });
        familyId = attach.familyId;
        if (attach.isNew) created++;
        else attached++;
      } catch (e) {
        console.warn(`family-attach failed for ${table}/${row.id}:`, e);
      }

      try {
        await patchRow(table, row.id, {
          embedding: toPgVector(v),
          family_id: familyId,
        });
      } catch (e) {
        console.error(`patch failed for ${table}/${row.id}:`, e);
        failed++;
      }
    }

    process.stdout.write(
      `  ${table}: ${Math.min(i + BATCH, rows.length)}/${rows.length}\r`,
    );
  }
  process.stdout.write("\n");
  return { embedded, attached, created, failed };
}

async function main(): Promise<void> {
  console.log(`backfill-hook-embeddings ${DRY_RUN ? "(dry run)" : ""}`);
  const familyStore = createPostgrestFamilyStore();
  const familyRoster = await familyStore.fetchAll();
  console.log(`  starting family roster: ${familyRoster.length} families`);

  const posts = await fetchUnembeddedPosts();
  const generated = await fetchUnembeddedGenerated();
  console.log(
    `  pending: ${posts.length} tiktok_posts, ${generated.length} generated_hooks`,
  );

  if (DRY_RUN) {
    console.log("  dry run — no writes performed");
    return;
  }

  const postsResult = await processTable("tiktok_posts", posts, familyRoster, familyStore);
  console.log(`  tiktok_posts:`, postsResult);

  const generatedResult = await processTable("generated_hooks", generated, familyRoster, familyStore);
  console.log(`  generated_hooks:`, generatedResult);

  console.log(`  final family roster: ${familyRoster.length} families`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
