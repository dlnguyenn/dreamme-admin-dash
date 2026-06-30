/**
 * CLI wrapper over the shared audience-sync pipeline (src/lib/audiences.ts).
 * The real logic lives there and is shared with /api/cron/refresh-audiences and
 * the Ads-MCP tools.
 *
 * Usage:
 *   npm run refresh-audiences                  # LIVE — creates/updates Meta audiences + attaches suppression
 *   npm run refresh-audiences -- --dry-run     # no Meta writes (snapshot + read-only discovery only)
 *   npm run refresh-audiences -- --days 90     # RC enumeration window (default 180)
 *
 * Required env (.env.local): REVENUECAT_API_KEY, REVENUECAT_PROJECT_ID,
 *   Meta OAuth connection (or META_ACCESS_TOKEN), service-role Supabase key.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { runAudienceSync } from "../src/lib/audiences";

const args = process.argv.slice(2);
const hasFlag = (n: string) => args.includes(`--${n}`);
const getArg = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? undefined : args[i + 1];
};

async function main() {
  const dryRun = hasFlag("dry-run");
  const windowDays = getArg("days") ? Number(getArg("days")) : undefined;
  console.error(`\n  Audience sync — ${dryRun ? "DRY RUN (no Meta writes)" : "LIVE"}${windowDays ? ` · ${windowDays}d` : ""}\n`);

  const result = await runAudienceSync({
    dryRun,
    windowDays,
    log: (m) => console.error(m),
  });

  console.log(JSON.stringify(result, null, 2));
  console.error(
    `\n  Done. active=${result.cohorts.active} highLtv=${result.cohorts.highLtv} lapsed=${result.cohorts.lapsed} · adsets=${result.prospectingAdSets.length}\n`,
  );
}

main().catch((e) => {
  console.error(`\n  ERROR: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
