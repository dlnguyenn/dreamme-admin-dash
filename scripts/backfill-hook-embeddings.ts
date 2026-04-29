/**
 * Backfill embeddings + family_id for existing rows in tiktok_posts and
 * generated_hooks. Run once after applying migration 0011.
 *
 * Usage:
 *   tsx scripts/backfill-hook-embeddings.ts                       # default: embed unembedded rows + attach to families
 *   tsx scripts/backfill-hook-embeddings.ts --dry-run             # preview pending counts, no writes
 *   tsx scripts/backfill-hook-embeddings.ts --rebuild-families    # wipe hook_families and re-cluster from existing embeddings
 *   tsx scripts/backfill-hook-embeddings.ts --rebuild-families --dry-run
 *
 * Reads: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY.
 *
 * Default mode is idempotent — only processes rows where embedding IS NULL.
 *
 * Rebuild mode is destructive against hook_families: it deletes every row
 * (FK on_delete=set null cascades family_id back to NULL on referencing
 * posts/hooks), then re-clusters using each row's existing embedding.
 * No re-embedding is performed in rebuild mode — Voyage cost is zero.
 * Use this when changing clustering knobs (similarity threshold,
 * category gate) and you want the full corpus re-grouped.
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { embed, parsePgVector, toPgVector, voyageConfigured } from "../src/lib/voyage";
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
const REBUILD = process.argv.includes("--rebuild-families");
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
  embedding: number[] | null;
}

async function fetchPosts(needsEmbed: boolean): Promise<Row[]> {
  const filter = needsEmbed
    ? "embedding=is.null&first_slide_text=not.is.null"
    : "embedding=not.is.null&first_slide_text=not.is.null";
  const url = `${SUPABASE_URL}/rest/v1/tiktok_posts?select=id,first_slide_text,category,embedding&${filter}&limit=10000`;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) die(`tiktok_posts fetch failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{
    id: string;
    first_slide_text: string | null;
    category: string | null;
    embedding: string | null;
  }>;
  return rows
    .filter((r) => r.first_slide_text && r.first_slide_text.trim())
    .map((r) => ({
      id: r.id,
      text: r.first_slide_text as string,
      category: r.category,
      embedding: parsePgVector(r.embedding),
    }));
}

async function fetchGenerated(needsEmbed: boolean): Promise<Row[]> {
  const filter = needsEmbed ? "embedding=is.null" : "embedding=not.is.null";
  const url = `${SUPABASE_URL}/rest/v1/generated_hooks?select=id,hook_text,category,embedding&${filter}&limit=10000`;
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) die(`generated_hooks fetch failed: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{
    id: string;
    hook_text: string;
    category: string | null;
    embedding: string | null;
  }>;
  return rows
    .filter((r) => r.hook_text && r.hook_text.trim())
    .map((r) => ({
      id: r.id,
      text: r.hook_text,
      category: r.category,
      embedding: parsePgVector(r.embedding),
    }));
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

async function wipeFamilies(): Promise<void> {
  if (DRY_RUN) return;
  // FK on_delete=set null cascades family_id to NULL on posts/hooks.
  const url = `${SUPABASE_URL}/rest/v1/hook_families?id=neq.00000000-0000-0000-0000-000000000000`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=minimal" },
  });
  if (!res.ok) die(`hook_families wipe failed: ${res.status} ${await res.text()}`);
}

async function processTable(
  table: "tiktok_posts" | "generated_hooks",
  rows: Row[],
  familyRoster: FamilyRow[],
  familyStore: ReturnType<typeof createPostgrestFamilyStore>,
  embedRequired: boolean,
): Promise<{ embedded: number; attached: number; created: number; failed: number }> {
  let embedded = 0;
  let attached = 0;
  let created = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    let vectors: number[][];
    if (embedRequired) {
      try {
        vectors = await embed(slice.map((r) => r.text));
        embedded += vectors.filter(Boolean).length;
      } catch (e) {
        console.error(`embed batch failed at offset ${i}:`, e);
        failed += slice.length;
        continue;
      }
    } else {
      vectors = slice.map((r) => r.embedding ?? []);
    }

    for (let j = 0; j < slice.length; j++) {
      const row = slice[j];
      const v = vectors[j];
      if (!v || !v.length) {
        failed++;
        continue;
      }

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
        const patch: Record<string, unknown> = { family_id: familyId };
        if (embedRequired) patch.embedding = toPgVector(v);
        await patchRow(table, row.id, patch);
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
  const mode = REBUILD ? "rebuild-families" : "default";
  const flags = [DRY_RUN ? "(dry run)" : ""].filter(Boolean).join(" ");
  console.log(`backfill-hook-embeddings [${mode}] ${flags}`);

  if (REBUILD) {
    console.log("  wiping hook_families (FK cascades family_id→null on posts/hooks)…");
    await wipeFamilies();
  }

  const familyStore = createPostgrestFamilyStore();
  const familyRoster = await familyStore.fetchAll();
  console.log(`  starting family roster: ${familyRoster.length} families`);

  const needsEmbed = !REBUILD;
  const posts = await fetchPosts(needsEmbed);
  const generated = await fetchGenerated(needsEmbed);
  console.log(
    `  pending: ${posts.length} tiktok_posts, ${generated.length} generated_hooks`,
  );

  if (DRY_RUN) {
    console.log("  dry run — no writes performed");
    return;
  }

  const postsResult = await processTable(
    "tiktok_posts",
    posts,
    familyRoster,
    familyStore,
    needsEmbed,
  );
  console.log(`  tiktok_posts:`, postsResult);

  const generatedResult = await processTable(
    "generated_hooks",
    generated,
    familyRoster,
    familyStore,
    needsEmbed,
  );
  console.log(`  generated_hooks:`, generatedResult);

  console.log(`  final family roster: ${familyRoster.length} families`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
