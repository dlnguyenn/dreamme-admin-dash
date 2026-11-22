/**
 * Load a competitor archive pull (Foreplay JSON kept in the vault) and the
 * ranked hook CSV into the Competitor ads tab's tables:
 * competitor_archive_ads and competitor_hooks (migration 0122).
 *
 *   npx tsx scripts/import-competitor-archive.ts --dir <folder of *_ads_p*.json / *_spyder_rankings_*.json>
 *       [--hooks <ranked hooks .csv>] [--pulled 2026-11-21] [--dry]
 *
 * Re-running is safe: rows are upserted by id. A hook's pick is never sent, so
 * picks already made survive a re-import. Data stays out of this repo (public).
 *
 * Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY
 * (or SUPABASE_SERVICE_ROLE_KEY).
 */
import { loadEnvConfig } from "@next/env";
import * as fs from "fs";
import * as path from "path";
import { foreplayIdMap, parseArchiveFiles, parseHooksCsv } from "../src/lib/competitor-ads-tab/archive-import";

loadEnvConfig(process.cwd());

/** Brand prefix in the file names -> Ad Library page id (public ids). */
const PAGES: Record<string, string> = {
  meagain: "539227915950887",
  shotsy: "395893520263618",
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function upsert(table: string, rows: unknown[], onConflict: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and the service role key must be set");
  for (let i = 0; i < rows.length; i += 200) {
    const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows.slice(i, i + 200)),
    });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

async function main() {
  const dir = arg("dir");
  if (!dir) throw new Error("--dir is required");
  const pulled = arg("pulled") ?? (/(\d{4}-\d{2}-\d{2})/.exec(path.basename(dir))?.[1] ?? new Date().toISOString().slice(0, 10));
  const dry = process.argv.includes("--dry");

  const files = fs
    .readdirSync(dir)
    .filter((n) => /\.json$/i.test(n) && /_(ads_p\d+|spyder_rankings_)/i.test(n))
    .map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), "utf8") }));
  const { rows, skipped } = parseArchiveFiles(files, PAGES, pulled);
  const byBrand = rows.reduce<Record<string, number>>((m, r) => ((m[r.brand] = (m[r.brand] ?? 0) + 1), m), {});
  console.log(`archive: ${rows.length} ads`, byBrand, `transcripts ${rows.filter((r) => r.transcript).length}`, `timed ${rows.filter((r) => r.timed_transcript).length}`);
  if (skipped.length) console.log("skipped files:", skipped.join(", "));

  let hooks: ReturnType<typeof parseHooksCsv> = [];
  const hooksFile = arg("hooks");
  if (hooksFile) {
    hooks = parseHooksCsv(fs.readFileSync(hooksFile, "utf8"), path.basename(hooksFile), foreplayIdMap(files));
    console.log(`hooks: ${hooks.length}, matched to an ad ${hooks.filter((h) => h.ad_archive_id).length}`);
  }

  if (dry) return console.log("dry run: nothing written");
  await upsert("competitor_archive_ads", rows, "ad_archive_id");
  if (hooks.length) await upsert("competitor_hooks", hooks, "id");
  console.log("written");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
