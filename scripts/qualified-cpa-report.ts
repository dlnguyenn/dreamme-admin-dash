/**
 * Qualified-CPA measurement report.
 *
 * Joins Meta ad-level insights with n8n trial-qualified workflow execution
 * counts to produce a markdown report of true qualified-CPA per ad set / ad,
 * applying the account-level qualified rate uniformly. Per-ad qualified rate
 * is not measurable until the iOS SDK captures fbc/fbp on install (separate
 * roadmap).
 *
 * Usage:
 *   npm run qualified-cpa                                 # last 30d, defaults from .env.local
 *   npm run qualified-cpa -- --days 7
 *   npm run qualified-cpa -- --days 30 --account act_1575502753719515
 *   npm run qualified-cpa > reports/2026-05-01.md
 *
 * Required env (.env.local):
 *   META_ACCESS_TOKEN
 *   META_AD_ACCOUNT_ID                       (or pass --account)
 *   N8N_API_KEY
 *   N8N_TRIAL_QUALIFIED_WORKFLOW_ID          (or pass --workflow)
 *
 * Optional env:
 *   META_API_VERSION                         (default v22.0)
 *   N8N_BASE_URL                             (default https://n8n.dreammeops.us)
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { fetchAdInsights, type AdInsightRow } from "../src/lib/vendors/meta-ads";
import { fetchExecutionCount } from "../src/lib/vendors/n8n";

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

function die(msg: string): never {
  console.error(`\n  ERROR: ${msg}\n`);
  process.exit(1);
}

// DreamMe defaults — override via env or --flag if these change.
const DEFAULT_ACCOUNT_ID = "act_1575502753719515";
const DEFAULT_WORKFLOW_ID = "wEZAcV8qNd0OTUBQ";

const days = Number(getArg("days") ?? "30");
const accountId =
  getArg("account") ?? process.env.META_AD_ACCOUNT_ID ?? DEFAULT_ACCOUNT_ID;
const workflowId =
  getArg("workflow") ??
  process.env.N8N_TRIAL_QUALIFIED_WORKFLOW_ID ??
  DEFAULT_WORKFLOW_ID;

if (!Number.isFinite(days) || days <= 0) die("--days must be a positive number");
if (!process.env.META_ACCESS_TOKEN)
  die("META_ACCESS_TOKEN not set in .env.local");
if (!process.env.N8N_API_KEY && !process.env.N8N_CLAUDE_ACCESS_KEY)
  die("N8N_API_KEY (or N8N_CLAUDE_ACCESS_KEY) not set in .env.local");

const until = new Date();
const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
const sinceDate = since.toISOString().slice(0, 10);
const untilDate = until.toISOString().slice(0, 10);

function fmtUSD(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}
function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
function safeDiv(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

async function main() {
  process.stderr.write(
    `Fetching Meta insights (${accountId}) + n8n executions (${workflowId}) for ${sinceDate}→${untilDate}...\n`,
  );
  const t0 = Date.now();
  const [insights, qualifiedCount] = await Promise.all([
    fetchAdInsights({ accountId, since: sinceDate, until: untilDate }),
    fetchExecutionCount({ workflowId, since, until, status: "success" }),
  ]);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  process.stderr.write(
    `Done in ${elapsed}s — ${insights.length} ads, ${qualifiedCount} qualified.\n`,
  );

  const totalSpend = insights.reduce((s, r) => s + r.spend, 0);
  const totalInstalls = insights.reduce((s, r) => s + r.installs, 0);
  const totalStartTrials = insights.reduce((s, r) => s + r.startTrials, 0);
  const qualifiedRate = safeDiv(qualifiedCount, totalStartTrials);
  const trueQualifiedCpa = safeDiv(totalSpend, qualifiedCount);
  const reportedCpa = safeDiv(totalSpend, totalStartTrials);

  // If we found zero start trials, dump action-type COUNTS to stderr so the
  // user can identify the right key by volume (rather than guessing by name).
  if (totalStartTrials === 0 && insights.length > 0) {
    const counts = new Map<string, number>();
    for (const r of insights) {
      for (const a of r.raw_actions) {
        counts.set(
          a.action_type,
          (counts.get(a.action_type) ?? 0) + (Number(a.value) || 0),
        );
      }
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    process.stderr.write(
      `\nWARNING: zero START_TRIAL events detected across ${insights.length} ads.\n` +
        `Action-type counts Meta returned (top by volume):\n` +
        ranked
          .map(([t, n]) => `  ${String(n).padStart(6)}  ${t}`)
          .join("\n") +
        `\n\nFor reference: ${qualifiedCount} trial_qualified events fired in n8n over the same window.\n` +
        `Pick the action_type whose count is closest to your expected START_TRIAL volume,\n` +
        `then add it to START_TRIAL_ACTION_TYPES in src/lib/vendors/meta-ads.ts.\n\n`,
    );
  }

  interface AdsetAgg {
    name: string;
    spend: number;
    installs: number;
    startTrials: number;
  }
  const adsetMap = new Map<string, AdsetAgg>();
  for (const r of insights) {
    const key = r.adset_id || "(unknown)";
    let a = adsetMap.get(key);
    if (!a) {
      a = { name: r.adset_name || key, spend: 0, installs: 0, startTrials: 0 };
      adsetMap.set(key, a);
    }
    a.spend += r.spend;
    a.installs += r.installs;
    a.startTrials += r.startTrials;
  }
  const adsetRows = [...adsetMap.values()].sort((a, b) => b.spend - a.spend);
  const adRows: AdInsightRow[] = [...insights].sort((a, b) => b.spend - a.spend);

  const lines: string[] = [];
  lines.push(`# Qualified-CPA Report — Last ${days}d (${sinceDate} → ${untilDate})`);
  lines.push("");
  lines.push("## Account totals");
  lines.push(`- Spend: **${fmtUSD(totalSpend)}**`);
  lines.push(`- Installs: ${fmtInt(totalInstalls)}`);
  lines.push(`- START_TRIAL (Meta-reported): ${fmtInt(totalStartTrials)}`);
  lines.push(`- Trials qualified (n8n bridge): ${fmtInt(qualifiedCount)}`);
  lines.push(`- **Qualified rate:** ${fmtPct(qualifiedRate)}`);
  lines.push(`- **True qualified CPA:** ${fmtUSD(trueQualifiedCpa)}`);
  lines.push(
    `- Reported START_TRIAL CPA: ${fmtUSD(reportedCpa)}  *(inflated; ~${fmtPct(1 - qualifiedRate)} of START_TRIALs don't qualify)*`,
  );
  lines.push("");

  lines.push(`## Ad sets (sorted by spend)`);
  lines.push("");
  lines.push(
    "| Ad set | Spend | Installs | START_TRIAL | Reported CPA | Est. qualified* | Blended qualified CPA* |",
  );
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const r of adsetRows) {
    const estQualified = r.startTrials * qualifiedRate;
    const blendedCpa = safeDiv(r.spend, estQualified);
    const repCpa = safeDiv(r.spend, r.startTrials);
    lines.push(
      `| ${r.name} | ${fmtUSD(r.spend)} | ${fmtInt(r.installs)} | ${fmtInt(r.startTrials)} | ${fmtUSD(repCpa)} | ${estQualified.toFixed(1)} | ${fmtUSD(blendedCpa)} |`,
    );
  }
  lines.push("");

  lines.push(`## Ads (sorted by spend)`);
  lines.push("");
  lines.push(
    "| Ad | Ad set | Spend | Installs | START_TRIAL | Reported CPA | Est. qualified* | Blended qualified CPA* |",
  );
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const r of adRows) {
    const estQualified = r.startTrials * qualifiedRate;
    const blendedCpa = safeDiv(r.spend, estQualified);
    const repCpa = safeDiv(r.spend, r.startTrials);
    lines.push(
      `| ${r.ad_name} | ${r.adset_name} | ${fmtUSD(r.spend)} | ${fmtInt(r.installs)} | ${fmtInt(r.startTrials)} | ${fmtUSD(repCpa)} | ${estQualified.toFixed(1)} | ${fmtUSD(blendedCpa)} |`,
    );
  }
  lines.push("");

  lines.push("## Caveats");
  lines.push(
    "- *Per-ad qualified counts apply the account-level qualified rate uniformly. Real per-creative rate may differ but isn't measurable until the iOS SDK captures fbc/fbp on install (separate roadmap).",
  );
  lines.push(
    "- Ranking by `Blended qualified CPA` is identical to ranking by `Reported CPA` (same constant multiplier). The blended column is for absolute numbers, not for picking winners.",
  );
  lines.push("- Date range is UTC. Meta data for the last 24-48h may be incomplete.");
  lines.push(
    `- n8n count = successful executions of workflow \`${workflowId}\` in the window. Failed executions excluded.`,
  );
  lines.push("- Meta token expires 2026-06-30 — the script throws clearly if expired.");
  lines.push("");

  console.log(lines.join("\n"));
}

main().catch((e: Error) => die(e.message));
