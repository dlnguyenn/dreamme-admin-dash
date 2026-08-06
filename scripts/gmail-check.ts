/**
 * Preflight for the Gmail-API support ingest. Reads only — inserts nothing.
 *
 * Usage:
 *   npm run gmail-check
 *
 * Confirms the refresh token works, shows which label ingestion is scoped to,
 * and previews the messages the next poll would pick up. Run this before
 * setting GMAIL_REFRESH_TOKEN in Vercel: once it's set in production the
 * Gmail leg takes over from IMAP on the very next poll.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import {
  getProfile,
  gmailConfigured,
  labelIdByName,
  listLabels,
  supportLabel,
} from "../src/lib/vendors/gmail";
import { fetchNewGmailMessages } from "../src/lib/support/gmail-ingest";

async function main() {
  if (!gmailConfigured()) {
    console.error(
      "\n  Not configured. Needs GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET\n" +
        "  and GMAIL_REFRESH_TOKEN in .env.local — run `npm run gmail-auth` for the last one.\n",
    );
    process.exit(1);
  }

  const profile = await getProfile();
  console.log(`\n  Authorized as ${profile.emailAddress}`);
  console.log(`  Current historyId: ${profile.historyId}`);

  const wanted = supportLabel();
  if (wanted) {
    const id = await labelIdByName(wanted);
    console.log(
      id
        ? `  Scoped to label "${wanted}" (${id})`
        : `  !! SUPPORT_GMAIL_LABEL="${wanted}" matches NO label — ingest would fail`,
    );
  } else {
    console.log(
      "  No SUPPORT_GMAIL_LABEL set — falling back to a to:help@/feedback@ query.",
    );
    const userLabels = (await listLabels()).filter((l) => l.type !== "system");
    console.log(`  Your labels: ${userLabels.map((l) => l.name).join(", ") || "(none)"}`);
  }

  console.log("\n  Previewing what the next poll would ingest (cold start, 7-day look-back)…");
  const { messages, historyId, truncated, usedFallback } = await fetchNewGmailMessages(null);
  console.log(
    `  ${messages.length} message(s)${truncated ? " (capped)" : ""}, cursor would become ${historyId}${usedFallback ? " [via list fallback]" : ""}\n`,
  );
  for (const m of messages.slice(0, 15)) {
    console.log(
      `    ${m.date.toISOString().slice(0, 16)}  ${(m.fromEmail ?? "?").padEnd(32)} ${(m.subject ?? "(no subject)").slice(0, 52)}`,
    );
  }
  if (messages.length > 15) console.log(`    … and ${messages.length - 15} more`);
  console.log("");
}

main().catch((e) => {
  console.error(`\n  ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
