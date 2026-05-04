/**
 * Pulls new/changed transactions from Plaid via /transactions/sync and
 * mirrors them into plaid_transactions, then re-aggregates the past N
 * days into spend_line_items.
 *
 * Re-aggregating from the local table (rather than running totals) is
 * what makes this robust against modifications and removals — Plaid
 * regularly updates pending transactions to settled, and occasionally
 * removes erroneous ones. Recomputing from a single source of truth
 * means we never drift.
 */

import {
  getPlaidClient,
  plaidConfigured,
  plaidErrorMessage,
} from "@/lib/vendors/plaid";
import { categorizeMerchant } from "./chase-csv";
import type { SpendVendor } from "../types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const VENDOR_CATEGORY: Record<SpendVendor, "ai" | "business"> = {
  anthropic: "ai",
  google: "ai",
  apify: "ai",
  vercel: "ai",
  supabase: "ai",
  business_cc: "business",
  other: "business",
};

const AUTO_TRACKED_VENDORS = new Set<SpendVendor>([
  "anthropic",
  "google",
  "apify",
  "vercel",
  "supabase",
]);

const LOOKBACK_DAYS = 40;

interface PlaidItemRow {
  item_id: string;
  access_token: string;
  cursor: string | null;
}

interface SyncResult {
  itemId: string;
  added: number;
  modified: number;
  removed: number;
  upsertedSpendRows: number;
  error?: string;
}

async function supabaseFetch(path: string, init?: RequestInit) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function fetchItems(): Promise<PlaidItemRow[]> {
  const res = await supabaseFetch("plaid_items?select=item_id,access_token,cursor");
  if (!res.ok) {
    throw new Error(`fetch items failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as PlaidItemRow[];
}

async function syncOneItem(item: PlaidItemRow): Promise<SyncResult> {
  const result: SyncResult = {
    itemId: item.item_id,
    added: 0,
    modified: 0,
    removed: 0,
    upsertedSpendRows: 0,
  };
  const client = getPlaidClient();

  let cursor: string | undefined = item.cursor ?? undefined;
  let hasMore = true;

  while (hasMore) {
    const sync = await client.transactionsSync({
      access_token: item.access_token,
      cursor,
      count: 500,
    });
    const data = sync.data;
    cursor = data.next_cursor;
    hasMore = data.has_more;

    if (data.added.length) {
      result.added += data.added.length;
      const rows = data.added.map((t) => ({
        item_id: item.item_id,
        plaid_transaction_id: t.transaction_id,
        account_id: t.account_id,
        date: t.date,
        authorized_date: t.authorized_date ?? null,
        name: t.name,
        merchant_name: t.merchant_name ?? null,
        amount: t.amount,
        iso_currency_code: t.iso_currency_code ?? null,
        pending: t.pending,
        category: t.category ?? null,
        removed_at: null,
        updated_at: new Date().toISOString(),
      }));
      const ins = await supabaseFetch(
        "plaid_transactions?on_conflict=plaid_transaction_id",
        {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(rows),
        },
      );
      if (!ins.ok) {
        throw new Error(`add upsert failed: ${ins.status} ${await ins.text()}`);
      }
    }

    if (data.modified.length) {
      result.modified += data.modified.length;
      const rows = data.modified.map((t) => ({
        item_id: item.item_id,
        plaid_transaction_id: t.transaction_id,
        account_id: t.account_id,
        date: t.date,
        authorized_date: t.authorized_date ?? null,
        name: t.name,
        merchant_name: t.merchant_name ?? null,
        amount: t.amount,
        iso_currency_code: t.iso_currency_code ?? null,
        pending: t.pending,
        category: t.category ?? null,
        removed_at: null,
        updated_at: new Date().toISOString(),
      }));
      const upd = await supabaseFetch(
        "plaid_transactions?on_conflict=plaid_transaction_id",
        {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(rows),
        },
      );
      if (!upd.ok) {
        throw new Error(`modify upsert failed: ${upd.status} ${await upd.text()}`);
      }
    }

    if (data.removed.length) {
      result.removed += data.removed.length;
      // Soft-delete: mark removed_at so historical aggregates can ignore.
      const ids = data.removed.map((r) => r.transaction_id);
      const del = await supabaseFetch(
        `plaid_transactions?plaid_transaction_id=in.(${ids
          .map((s) => `"${s}"`)
          .join(",")})`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ removed_at: new Date().toISOString() }),
        },
      );
      if (!del.ok) {
        throw new Error(`remove failed: ${del.status} ${await del.text()}`);
      }
    }
  }

  // Persist the new cursor.
  await supabaseFetch(`plaid_items?item_id=eq.${item.item_id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      cursor: cursor ?? null,
      last_sync_at: new Date().toISOString(),
      last_sync_error: null,
      updated_at: new Date().toISOString(),
    }),
  });

  return result;
}

interface AggKey {
  vendor: SpendVendor;
  date: string;
}

async function rebuildSpendLineItems(): Promise<number> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);
  const sinceIso = since.toISOString().slice(0, 10);

  // Fetch only non-removed transactions in the window. Plaid amounts are
  // POSITIVE for charges (money out) and NEGATIVE for credits (money in)
  // — opposite of the Chase CSV convention. We only want charges, and
  // only those that map to vendors we don't already track via API.
  const res = await supabaseFetch(
    `plaid_transactions?select=date,name,merchant_name,amount&date=gte.${sinceIso}&removed_at=is.null&amount=gt.0`,
  );
  if (!res.ok) {
    throw new Error(`txn fetch failed: ${res.status} ${await res.text()}`);
  }
  const txns = (await res.json()) as Array<{
    date: string;
    name: string;
    merchant_name: string | null;
    amount: number;
  }>;

  const agg = new Map<
    string,
    {
      key: AggKey;
      amount: number;
      transactions: Array<{ description: string; amount: number }>;
    }
  >();
  for (const t of txns) {
    const desc = (t.merchant_name || t.name || "").trim();
    const vendor = categorizeMerchant(desc);
    if (AUTO_TRACKED_VENDORS.has(vendor)) continue;
    const key = `${vendor}|${t.date}`;
    const existing = agg.get(key);
    if (existing) {
      existing.amount = Math.round((existing.amount + t.amount) * 100) / 100;
      existing.transactions.push({ description: desc, amount: t.amount });
    } else {
      agg.set(key, {
        key: { vendor, date: t.date },
        amount: Math.round(t.amount * 100) / 100,
        transactions: [{ description: desc, amount: t.amount }],
      });
    }
  }

  if (!agg.size) {
    // Nothing to upsert — but also clear out any prior plaid rows in
    // this window so removed transactions don't leave ghosts.
    await supabaseFetch(
      `spend_line_items?source=eq.plaid&period_start=gte.${sinceIso}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } },
    );
    return 0;
  }

  // Wipe the window's plaid rows then re-insert. Simpler than diffing
  // and guaranteed correct under modifications + removals.
  const del = await supabaseFetch(
    `spend_line_items?source=eq.plaid&period_start=gte.${sinceIso}`,
    { method: "DELETE", headers: { Prefer: "return=minimal" } },
  );
  if (!del.ok) {
    throw new Error(`window clear failed: ${del.status} ${await del.text()}`);
  }

  const rows = Array.from(agg.values()).map((v) => ({
    vendor: v.key.vendor,
    category: VENDOR_CATEGORY[v.key.vendor],
    amount_usd: v.amount,
    period_start: v.key.date,
    period_end: v.key.date,
    source: "plaid",
    metadata: { transactions: v.transactions },
  }));

  const ins = await supabaseFetch("spend_line_items", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!ins.ok) {
    throw new Error(`spend insert failed: ${ins.status} ${await ins.text()}`);
  }
  return rows.length;
}

export async function syncAllPlaidItems(): Promise<{
  items: SyncResult[];
  upsertedSpendRows: number;
}> {
  if (!plaidConfigured()) {
    throw new Error("Plaid not configured");
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error("Supabase service role not configured");
  }

  const items = await fetchItems();
  const results: SyncResult[] = [];

  for (const item of items) {
    try {
      results.push(await syncOneItem(item));
    } catch (err) {
      const msg = plaidErrorMessage(err);
      results.push({
        itemId: item.item_id,
        added: 0,
        modified: 0,
        removed: 0,
        upsertedSpendRows: 0,
        error: msg,
      });
      // Persist the error so the UI can surface what went wrong.
      await supabaseFetch(`plaid_items?item_id=eq.${item.item_id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          last_sync_error: msg,
          updated_at: new Date().toISOString(),
        }),
      });
    }
  }

  // Re-aggregate even if some items failed — the ones that succeeded
  // contributed transactions we should reflect.
  const upsertedSpendRows = await rebuildSpendLineItems();
  return { items: results, upsertedSpendRows };
}
