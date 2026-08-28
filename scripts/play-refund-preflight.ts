/**
 * Read-only preflight for the support "Refund & revoke (RevenueCat)" action.
 * Resolves what refundAndRevokePlaySubscription WOULD refund for a given
 * app_user_id — subscription, latest store transaction, amount — without
 * touching anything. Use it to sanity-check before clicking the button, or
 * to debug a failed attempt.
 *
 * Usage: npx tsx scripts/play-refund-preflight.ts --app-user-id <id>
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { getCustomerSubscriptions } from "../src/lib/vendors/revenuecat";

const args = process.argv.slice(2);
const getArg = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? undefined : args[i + 1];
};

async function main() {
  const appUserId = getArg("app-user-id");
  if (!appUserId) {
    console.error("Usage: npx tsx scripts/play-refund-preflight.ts --app-user-id <id>");
    process.exit(1);
  }
  const key = process.env.REVENUECAT_API_KEY ?? "";
  const projectId = process.env.REVENUECAT_PROJECT_ID ?? "";
  if (!key || !projectId) throw new Error("REVENUECAT_API_KEY / PROJECT_ID not set");

  const subs = await getCustomerSubscriptions(appUserId);
  console.log(`Subscriptions for ${appUserId}:`);
  for (const s of subs) {
    console.log(
      `  ${s.id}  store=${s.store}  status=${s.status}  gives_access=${s.gives_access}  product=${s.product_id}  renew=${s.auto_renewal_status}`,
    );
  }
  const play = subs.filter((s) => s.store === "play_store");
  if (play.length === 0) {
    console.log("No Play Store subscription — the refund action would refuse.");
    return;
  }
  const target =
    play.find((s) => s.gives_access) ??
    play.sort(
      (a, b) => (b.current_period_ends_at ?? 0) - (a.current_period_ends_at ?? 0),
    )[0];
  console.log(`\nRefund target subscription: ${target.id}`);

  const res = await fetch(
    `https://api.revenuecat.com/v2/projects/${projectId}/subscriptions/${encodeURIComponent(target.id)}/transactions?sort=purchased_at&direction=desc`,
    { headers: { Authorization: `Bearer ${key}`, accept: "application/json" } },
  );
  if (!res.ok) {
    throw new Error(`transactions fetch failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const body = (await res.json()) as {
    items?: Array<{
      id: string;
      purchased_at: number;
      product_store_identifier: string;
      revenue_in_usd?: { gross?: number | null } | null;
    }>;
  };
  const items = body.items ?? [];
  console.log(`\nTransactions (${items.length}):`);
  for (const t of items) {
    console.log(
      `  ${t.id}  purchased=${new Date(t.purchased_at).toISOString()}  product=${t.product_store_identifier}  gross_usd=${t.revenue_in_usd?.gross ?? "n/a"}`,
    );
  }
  if (items.length > 0) {
    console.log(
      `\nWould refund+revoke transaction ${items[0].id} on subscription ${target.id}.`,
    );
  } else {
    console.log("\nNo transactions — the refund action would refuse.");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
