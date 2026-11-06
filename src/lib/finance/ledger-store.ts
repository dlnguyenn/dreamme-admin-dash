/**
 * expense_ledger reads and writes. Rules and totals are in ./tax-ledger.ts.
 *
 * Inserts ignore duplicates on id, so a row someone edited on the Spend tab is
 * never overwritten by the daily ingest or a repeat CSV upload.
 */
import { businessRows, type StoredTxn } from "./chase-alerts";
import {
  ALL_CATEGORIES,
  parseChaseCsv,
  rowFromUnparsedAlert,
  rowsFromAlerts,
  rowsFromCsv,
  rowsToImport,
  type LedgerEntry,
  type LedgerRow,
  type TaxCategory,
} from "./tax-ledger";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";

async function sb<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} (${path.split("?")[0]}): ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

interface DbRow {
  id: string;
  txn_date: string;
  account: string;
  description: string;
  amount: number | string | null;
  category: TaxCategory;
  review: string;
  notes: string;
  source: LedgerRow["source"];
}

/** PostgREST caps a read at 1,000 rows, so page through. */
const PAGE = 1000;

export async function loadLedger(): Promise<LedgerEntry[]> {
  const out: LedgerEntry[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await sb<DbRow[]>(
      `expense_ledger?select=id,txn_date,account,description,amount,category,review,notes,source&order=txn_date.desc,id.asc&limit=${PAGE}&offset=${offset}`,
    );
    for (const r of page) {
      out.push({
        id: r.id,
        date: r.txn_date,
        account: r.account,
        description: r.description,
        amount: r.amount === null ? null : Number(r.amount),
        category: r.category,
        review: r.review,
        notes: r.notes,
        source: r.source,
      });
    }
    if (page.length < PAGE) return out;
  }
}

/** Returns how many rows were new. */
async function addRows(rows: LedgerRow[]): Promise<number> {
  let added = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const body = rows.slice(i, i + 200).map((r) => ({
      id: r.id,
      txn_date: r.date,
      account: r.account,
      description: r.description,
      amount: r.amount,
      category: r.category,
      review: r.review,
      source: r.source,
    }));
    const inserted = await sb<{ id: string }[]>("expense_ledger?on_conflict=id&select=id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(body),
    });
    added += inserted.length;
  }
  return added;
}

/** Copies every business alert, and any unreadable one, into the ledger. */
export async function syncLedgerFromAlerts(): Promise<number> {
  const [txnRows, unparsed] = await Promise.all([
    sb<{ gmail_id: string; txn_date: string; amount: number; description: string; kind: string; last4: string }[]>(
      "chase_alert_messages?select=gmail_id,txn_date,amount,description,kind,last4&status=eq.txn&order=txn_date.desc&limit=1000",
    ),
    sb<{ gmail_id: string; subject: string | null; received_at: string | null }[]>(
      "chase_alert_messages?select=gmail_id,subject,received_at&status=eq.unparsed&limit=1000",
    ),
  ]);
  const { rows } = businessRows(
    txnRows.map(
      (r): StoredTxn => ({
        messageId: r.gmail_id,
        date: r.txn_date,
        amount: Number(r.amount),
        description: r.description,
        kind: r.kind as StoredTxn["kind"],
        last4: r.last4,
      }),
    ),
  );
  return addRows([
    ...rowsFromAlerts(rows.map((r) => ({ gmailId: r.messageId, last4: r.last4, date: r.date, description: r.description, amount: r.amount }))),
    ...unparsed.map((m) => rowFromUnparsedAlert({ gmailId: m.gmail_id, date: (m.received_at ?? new Date().toISOString()).slice(0, 10), subject: m.subject })),
  ]);
}

export interface ImportResult {
  rowsInFile: number;
  added: number;
  alreadyHere: number;
}

export async function importChaseCsv(filename: string, text: string): Promise<ImportResult> {
  const csvRows = rowsFromCsv(parseChaseCsv(filename, text));
  const added = await addRows(rowsToImport(csvRows, await loadLedger()));
  return { rowsInFile: csvRows.length, added, alreadyHere: csvRows.length - added };
}

export interface LedgerEdit {
  category?: string;
  notes?: string;
  review?: string;
}

export async function updateLedgerRow(id: string, edit: LedgerEdit): Promise<void> {
  if (edit.category !== undefined && !ALL_CATEGORIES.includes(edit.category as TaxCategory)) {
    throw new Error(`Unknown category: ${edit.category}`);
  }
  const patch: Record<string, string> = { updated_at: new Date().toISOString() };
  if (edit.category !== undefined) patch.category = edit.category;
  if (edit.notes !== undefined) patch.notes = edit.notes;
  if (edit.review !== undefined) patch.review = edit.review;
  const updated = await sb<{ id: string }[]>(`expense_ledger?id=eq.${encodeURIComponent(id)}&select=id`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!updated.length) throw new Error("That row no longer exists");
}
