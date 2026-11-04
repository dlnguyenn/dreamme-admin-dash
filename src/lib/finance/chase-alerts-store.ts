/**
 * Chase alert ingest: Gmail (dan@dreamme.life) -> chase_alert_messages.
 * Parsing is in ./chase-alerts.ts; this file only fetches and stores.
 *
 * Runs daily from /api/cron/chase-alerts and from the Spend tab's "Sync
 * Chase" button. Idempotent: rows are keyed by Gmail message id, so a run
 * only fetches messages it hasn't stored. Every run is logged to
 * chase_alert_runs, which is what the Spend tab's freshness line reads (no
 * Chase mail yet is a normal state until the Gmail forward from
 * dlnguyenn@gmail.com exists, and must not look like a broken cron).
 *
 * Gmail access is the Support Inbox's read-only token (src/lib/vendors/gmail.ts).
 * Chase mail never reaches the Support Inbox: that ingest is label/alias
 * scoped, and support/ingest.ts also skips chase.com senders outright.
 */
import { simpleParser } from "mailparser";
import { getMessage, gmailConfigured, listRecentMessageIds, MessageGoneError } from "@/lib/vendors/gmail";
import {
  PARSER_VERSION,
  accountFreshness,
  businessRows,
  easternToday,
  htmlToText,
  monthlySpend,
  parseAlert,
  senderAddress,
  type ParseResult,
  type StoredTxn,
} from "./chase-alerts";

/** Look-back for the Gmail search. Covers several missed days. */
const DEFAULT_DAYS = 7;
/** New messages fetched per run; the rest wait for the next run. */
const MAX_FETCH = 200;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";
const sbHeaders = () => ({ apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" });

export function chaseAlertsDbConfigured(): boolean {
  return !!SUPABASE_URL && !!SERVICE_ROLE;
}

async function sb<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...sbHeaders(), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase ${res.status} (${path.split("?")[0]}): ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

// ── Rows ───────────────────────────────────────────────────────────────

export interface MessageRow {
  gmail_id: string;
  message_id: string | null;
  received_at: string | null;
  from_email: string | null;
  subject: string | null;
  html_text: string | null;
  text_body: string | null;
  status: ParseResult["status"];
  reason: string | null;
  txn_date: string | null;
  amount: number | null;
  description: string | null;
  kind: string | null;
  last4: string | null;
  parser_version: number;
  parsed_at: string;
}

type ParsedFields = Pick<MessageRow, "status" | "reason" | "txn_date" | "amount" | "description" | "kind" | "last4" | "parser_version" | "parsed_at">;

/**
 * Chase sends HTML (label rows survive as "Account | ...") and usually a
 * text part too. Try the HTML first; a transaction from either wins, then an
 * ignore, and only if both are unreadable is the email unparsed.
 */
export function parseStored(m: { from: string; subject: string; date: string; id: string; htmlText: string | null; textBody: string | null }): ParseResult {
  const bodies = [m.htmlText, m.textBody].filter((b): b is string => !!b && !!b.trim());
  if (!bodies.length) bodies.push("");
  const results = bodies.map((body) => parseAlert({ id: m.id, from: m.from, subject: m.subject, date: m.date, body }));
  return results.find((r) => r.status === "txn") ?? results.find((r) => r.status === "ignore") ?? results[0];
}

function parsedFields(r: ParseResult): ParsedFields {
  const base = { parser_version: PARSER_VERSION, parsed_at: new Date().toISOString() };
  if (r.status === "txn") {
    const t = r.txn;
    return { ...base, status: "txn", reason: null, txn_date: t.date, amount: t.amount, description: t.description, kind: t.kind, last4: t.last4 };
  }
  return { ...base, status: r.status, reason: r.reason, txn_date: null, amount: null, description: null, kind: null, last4: null };
}

async function existingIds(ids: string[]): Promise<Set<string>> {
  const have = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100).map(encodeURIComponent).join(",");
    const rows = await sb<{ gmail_id: string }[]>(`chase_alert_messages?select=gmail_id&gmail_id=in.(${chunk})`);
    for (const r of rows) have.add(r.gmail_id);
  }
  return have;
}

async function fetchRow(gmailId: string): Promise<MessageRow | null> {
  try {
    return await messageRowFromRaw(gmailId, (await getMessage(gmailId)).raw);
  } catch (e) {
    if (e instanceof MessageGoneError) return null;
    throw e;
  }
}

/** One raw RFC 822 email -> its stored, parsed row. */
export async function messageRowFromRaw(gmailId: string, raw: Buffer | string): Promise<MessageRow> {
  const mail = await simpleParser(raw);
  const from = mail.from?.text ?? "";
  const subject = mail.subject ?? "";
  const date = mail.date ? mail.date.toISOString() : "";
  const htmlText = typeof mail.html === "string" && mail.html ? htmlToText(mail.html) : null;
  const textBody = mail.text?.trim() ? mail.text : null;
  const parsed = parseStored({ id: gmailId, from, subject, date, htmlText, textBody });
  return {
    gmail_id: gmailId,
    message_id: mail.messageId ?? null,
    received_at: date || null,
    from_email: senderAddress(from) || null,
    subject: subject.slice(0, 300),
    html_text: htmlText?.slice(0, 20_000) ?? null,
    text_body: textBody?.slice(0, 20_000) ?? null,
    ...parsedFields(parsed),
  };
}

/** Stored emails parsed by an older parser, re-read from their saved text. */
async function reparseOld(): Promise<number> {
  const rows = await sb<MessageRow[]>(
    `chase_alert_messages?select=gmail_id,from_email,subject,received_at,html_text,text_body&parser_version=lt.${PARSER_VERSION}&limit=1000`,
  );
  for (const r of rows) {
    const parsed = parseStored({
      id: r.gmail_id,
      // from_email is the bare address, which is all the sender check reads.
      from: r.from_email ?? "",
      subject: r.subject ?? "",
      date: r.received_at ?? "",
      htmlText: r.html_text,
      textBody: r.text_body,
    });
    await sb(`chase_alert_messages?gmail_id=eq.${encodeURIComponent(r.gmail_id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(parsedFields(parsed)),
    });
  }
  return rows.length;
}

// ── Sync ───────────────────────────────────────────────────────────────

export interface ChaseSyncResult {
  ok: boolean;
  /** Chase messages Gmail returned for the look-back window */
  listed: number;
  /** new ones fetched and stored this run */
  inserted: number;
  reparsed: number;
  /** more new mail than MAX_FETCH; the next run picks up the rest */
  truncated: boolean;
  error?: string;
}

async function logRun(trigger: "cron" | "manual", r: ChaseSyncResult): Promise<void> {
  await sb("chase_alert_runs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([
      { trigger, ok: r.ok, listed: r.listed, inserted: r.inserted, reparsed: r.reparsed, truncated: r.truncated, error: r.error ?? null },
    ]),
  });
}

export async function syncChaseAlerts(opts: { days?: number; trigger?: "cron" | "manual" } = {}): Promise<ChaseSyncResult> {
  const days = Math.min(Math.max(Math.round(opts.days ?? DEFAULT_DAYS), 1), 90);
  const result: ChaseSyncResult = { ok: false, listed: 0, inserted: 0, reparsed: 0, truncated: false };
  try {
    if (!gmailConfigured()) throw new Error("Gmail not configured (GOOGLE_OAUTH_CLIENT_ID / _SECRET / GMAIL_REFRESH_TOKEN)");
    result.reparsed = await reparseOld();

    const ids = await listRecentMessageIds({ q: `from:chase.com newer_than:${days}d`, max: 500 });
    result.listed = ids.length;
    const have = await existingIds(ids);
    const fresh = ids.filter((id) => !have.has(id));
    result.truncated = fresh.length > MAX_FETCH || ids.length === 500;

    const rows: MessageRow[] = [];
    for (const id of fresh.slice(0, MAX_FETCH)) {
      const row = await fetchRow(id);
      if (row) rows.push(row);
    }
    for (let i = 0; i < rows.length; i += 100) {
      await sb("chase_alert_messages?on_conflict=gmail_id", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(rows.slice(i, i + 100)),
      });
    }
    result.inserted = rows.length;
    result.ok = true;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }
  await logRun(opts.trigger ?? "cron", result).catch(() => {});
  return result;
}

// ── Summary for the Spend tab ──────────────────────────────────────────

export interface ChaseRun {
  ran_at: string;
  trigger: string;
  ok: boolean;
  listed: number | null;
  inserted: number | null;
  reparsed: number | null;
  truncated: boolean | null;
  error: string | null;
}

export async function loadChaseSummary(months = 6) {
  const [lastRuns, lastOk, txnRows, problemRows, counts] = await Promise.all([
    sb<ChaseRun[]>("chase_alert_runs?select=ran_at,trigger,ok,listed,inserted,reparsed,truncated,error&order=ran_at.desc&limit=1"),
    sb<ChaseRun[]>("chase_alert_runs?select=ran_at,trigger,ok,listed,inserted,reparsed,truncated,error&ok=is.true&order=ran_at.desc&limit=1"),
    sb<{ gmail_id: string; txn_date: string; amount: number; description: string; kind: string; last4: string }[]>(
      "chase_alert_messages?select=gmail_id,txn_date,amount,description,kind,last4&status=eq.txn&order=txn_date.desc&limit=10000",
    ),
    sb<{ gmail_id: string; subject: string | null; reason: string | null; received_at: string | null }[]>(
      "chase_alert_messages?select=gmail_id,subject,reason,received_at&status=eq.unparsed&order=received_at.desc&limit=50",
    ),
    sb<{ status: string; received_at: string | null }[]>(
      "chase_alert_messages?select=status,received_at&order=received_at.desc&limit=10000",
    ),
  ]);

  const txns: StoredTxn[] = txnRows.map((r) => ({
    messageId: r.gmail_id,
    date: r.txn_date,
    amount: Number(r.amount),
    description: r.description,
    kind: r.kind as StoredTxn["kind"],
    last4: r.last4,
  }));
  const { rows, personal, unknown } = businessRows(txns);
  const today = easternToday();
  const monthsWanted = new Set(
    Array.from({ length: months }, (_, i) => {
      const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - i);
      return d.toISOString().slice(0, 7);
    }),
  );

  return {
    today,
    lastRun: lastRuns[0] ?? null,
    lastOkRun: lastOk[0] ?? null,
    emails: {
      total: counts.length,
      txn: counts.filter((c) => c.status === "txn").length,
      ignored: counts.filter((c) => c.status === "ignore").length,
      unparsed: counts.filter((c) => c.status === "unparsed").length,
      newestReceivedAt: counts[0]?.received_at ?? null,
    },
    accounts: accountFreshness(txns, today),
    personalSkipped: personal,
    unknownAccounts: unknown,
    unparsed: problemRows,
    months: monthlySpend(rows).filter((m) => monthsWanted.has(m.month)),
    /** newest 100 business rows, any month */
    recent: rows.slice(-100).reverse(),
  };
}

export type ChaseSummary = Awaited<ReturnType<typeof loadChaseSummary>>;
