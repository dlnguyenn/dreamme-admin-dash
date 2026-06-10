/**
 * Refresh Meta Custom Audience + Lookalike from RevenueCat paid users.
 *
 * v1 scope: paid users only (anyone with an active entitlement).
 * Trial-starter cohort is deferred — RC v2 doesn't expose a clean
 * "any past subscription" enumeration that scales without N+1 over the
 * whole customer base, and we already have a strong-signal seed in paid.
 *
 * What it does:
 *   1. Pulls paying customers (last 180d) from RC, with email
 *   2. Writes a CSV audit file to tmp/meta-audiences/
 *   3. Creates a new Custom Audience in Meta
 *   4. Uploads hashed emails to that audience
 *   5. Waits ~30s, then creates a 1% US Lookalike from it
 *   6. Patches AI Video Test + Agency Video Test ad sets to include the
 *      new lookalike in their targeting
 *
 * Usage:
 *   npm run refresh-audiences                  # 180d window, full pipeline
 *   npm run refresh-audiences -- --days 90
 *   npm run refresh-audiences -- --dry-run     # CSV only, no Meta writes
 *   npm run refresh-audiences -- --skip-targeting   # skip adset patch
 *
 * Outputs:
 *   tmp/meta-audiences/paid-users-{YYYY-MM-DD}.csv
 *
 * Required env (.env.local):
 *   REVENUECAT_API_KEY, REVENUECAT_PROJECT_ID,
 *   META_ACCESS_TOKEN, META_AD_ACCOUNT_ID
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import fs from "node:fs";
import path from "node:path";
import {
  fetchPaidCustomersWithEmail,
  revenueCatConfigured,
  type PaidCustomerWithEmail,
} from "../src/lib/vendors/revenuecat";
import {
  createCustomAudience,
  uploadEmailsToAudience,
  createLookalike,
  addCustomAudiencesToAdSet,
  metaAdsConfigured,
} from "../src/lib/vendors/meta-ads";

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}
function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}
function die(msg: string): never {
  console.error(`\n  ERROR: ${msg}\n`);
  process.exit(1);
}

// DreamMe primary ad account — hardcoded fallback if not in .env.local
const DEFAULT_ACCOUNT_ID = "act_1575502753719515";

const days = Number(getArg("days") ?? "180");
const accountId = process.env.META_AD_ACCOUNT_ID ?? DEFAULT_ACCOUNT_ID;
const dryRun = hasFlag("dry-run");
const skipTargeting = hasFlag("skip-targeting");

// Ad sets to receive the new lookalike (the two test ad sets, per plan).
const TARGET_ADSETS = [
  { id: "120243985431000622", name: "AI Video Test" },
  { id: "120244041045720622", name: "Agency Video Test" },
];

if (!revenueCatConfigured()) die("RevenueCat env not set (REVENUECAT_API_KEY / REVENUECAT_PROJECT_ID).");
if (!dryRun) {
  if (!metaAdsConfigured()) die("META_ACCESS_TOKEN not set.");
  if (!accountId) die("META_AD_ACCOUNT_ID not set.");
}
if (!Number.isFinite(days) || days <= 0) die("--days must be a positive number");

const nowMs = Date.now();
const sinceMs = nowMs - days * 24 * 60 * 60 * 1000;
const today = new Date().toISOString().slice(0, 10);

const outDir = path.resolve("tmp/meta-audiences");
const csvPath = path.join(outDir, `paid-users-${today}.csv`);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function logStderr(msg: string): void {
  process.stderr.write(msg + "\n");
}

async function main() {
  logStderr(`\n=== Refresh Meta Audiences ===`);
  logStderr(`window: last ${days} days`);
  logStderr(`mode: ${dryRun ? "DRY RUN (no Meta writes)" : "LIVE"}`);
  logStderr("");

  // Step 1: pull paid customers from RC
  logStderr("--- Step 1: RC paid customers ---");
  const paidUsers: PaidCustomerWithEmail[] = await fetchPaidCustomersWithEmail({
    sinceMs,
    concurrency: 25,
    log: logStderr,
  });
  logStderr("");

  if (paidUsers.length === 0) {
    die("No paid users found with email. Abort.");
  }

  // Step 2: write CSV for audit
  logStderr("--- Step 2: write CSV ---");
  fs.mkdirSync(outDir, { recursive: true });
  const csvLines = ["email,customer_id,entitlement,first_seen_at_iso"];
  for (const u of paidUsers) {
    csvLines.push(
      [
        u.email,
        u.customerId,
        u.entitlement,
        new Date(u.firstSeenAt).toISOString(),
      ].join(","),
    );
  }
  fs.writeFileSync(csvPath, csvLines.join("\n"), "utf-8");
  logStderr(`  wrote ${paidUsers.length} rows → ${path.relative(process.cwd(), csvPath)}`);
  logStderr("");

  // Warn if cohort is small
  if (paidUsers.length < 100) {
    logStderr(`  WARNING: ${paidUsers.length} users is below Meta's 100-user minimum for a Custom Audience.`);
    logStderr(`  The audience can still be created but the Lookalike may fail.`);
  } else if (paidUsers.length < 500) {
    logStderr(`  NOTE: ${paidUsers.length} users — usable but on the small side for a Lookalike (1000+ recommended).`);
  }

  if (dryRun) {
    logStderr("\nDRY RUN complete — CSV written, no Meta writes performed.");
    return;
  }

  // Step 3: create Custom Audience in Meta
  logStderr("--- Step 3: create Custom Audience ---");
  const audienceName = `DreamMe Paid Users (${days}d, ${today})`;
  const audienceDesc = `Refreshed from RC ${today}. ${paidUsers.length} customers with active entitlement in last ${days}d. Apple-relay emails excluded.`;
  const audience = await createCustomAudience({
    accountId,
    name: audienceName,
    description: audienceDesc,
  });
  logStderr(`  created audience: ${audience.id} ("${audienceName}")`);
  logStderr("");

  // Step 4: upload hashed emails
  logStderr("--- Step 4: upload hashed emails ---");
  const uploadResult = await uploadEmailsToAudience({
    audienceId: audience.id,
    emails: paidUsers.map((u) => u.email),
    log: logStderr,
  });
  logStderr(`  uploaded ${uploadResult.uploadedCount} emails in ${uploadResult.batches} batch(es).`);
  logStderr("");

  // Step 5: wait for Meta ingestion before lookalike create
  logStderr("--- Step 5: wait 30s for Meta ingestion ---");
  await sleep(30_000);
  logStderr("");

  // Step 6: create 1% US Lookalike
  logStderr("--- Step 6: create Lookalike ---");
  const lalName = `LAL 1% US — DreamMe Paid Users (${days}d, ${today})`;
  const lookalike = await createLookalike({
    accountId,
    originAudienceId: audience.id,
    name: lalName,
    ratio: 0.01,
    country: "US",
  });
  logStderr(`  created lookalike: ${lookalike.id} ("${lalName}")`);
  logStderr(`  NOTE: Meta needs 6-24h to actually build the lookalike before it's usable in delivery.`);
  logStderr("");

  // Step 7: patch ad sets to add the new lookalike
  if (skipTargeting) {
    logStderr("--- Step 7: SKIPPED (--skip-targeting) ---");
    logStderr(`  apply manually in Ads Manager or re-run without --skip-targeting`);
    logStderr("");
  } else {
    logStderr("--- Step 7: patch ad-set targeting ---");
    for (const adset of TARGET_ADSETS) {
      try {
        await addCustomAudiencesToAdSet({
          adsetId: adset.id,
          audienceIds: [lookalike.id],
        });
        logStderr(`  ✓ ${adset.name} (${adset.id}) — added lookalike to targeting`);
      } catch (e) {
        logStderr(`  ✗ ${adset.name} (${adset.id}) — FAILED: ${(e as Error).message}`);
      }
    }
    logStderr("");
    logStderr(`  NOTE: targeting changes reset Meta's learning phase on these ad sets (~24-48h to re-stabilize).`);
  }

  logStderr("");
  logStderr(`=== Done ===`);
  logStderr(`Audience:  ${audience.id}`);
  logStderr(`Lookalike: ${lookalike.id}`);
  logStderr(`CSV:       ${path.relative(process.cwd(), csvPath)}`);
}

main().catch((e: Error) => die(e.message));
