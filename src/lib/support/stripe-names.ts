/**
 * Support Inbox — Stripe customer name index.
 *
 * Stripe has no name search: customer.name is null on every DreamMe
 * customer, and billing_details.name (present on ~98% of charges) is an
 * unsupported search field. We therefore mirror name/email per customer
 * into stripe_customer_names, refreshed from the charge list by the
 * support cron, and query it with SQL.
 *
 * Why it matters: people email support from a different address than the
 * card on file, so the email-only resolver reports "no account" for a
 * paying customer (seen live: writes from mayday422@aol.com, pays as
 * SMay@sjgov.org).
 */
import { spGet, spPost } from "./db";
import { stripeConfigured } from "@/lib/vendors/stripe";

const STRIPE_BASE = "https://api.stripe.com/v1";
/** Safety rail: 12 pages covers the entire charge history today (~1,186). */
const MAX_PAGES = 15;

export interface StripeNameRow {
  customer_id: string;
  name: string | null;
  email: string | null;
  last_charge_at: string | null;
  updated_at?: string;
}

interface ChargeLite {
  id: string;
  created: number;
  customer: string | null;
  receipt_email: string | null;
  billing_details?: { name?: string | null; email?: string | null } | null;
}

// ---------------------------------------------------------------------------
// Matching (pure — unit-tested)

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeName(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[.,'"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Tokens worth matching on. Drops initials and honorifics so "Dr. Mijares"
 * searches on "mijares", not "dr".
 */
const STOP_TOKENS = new Set(["dr", "mr", "mrs", "ms", "prof", "the", "via"]);

export function nameTokens(raw: string | null | undefined): string[] {
  return normalizeName(raw)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOP_TOKENS.has(t));
}

/**
 * Does an indexed billing name plausibly belong to this sender? Every
 * token of the sender's name must appear in the candidate, so
 * "Orsagos, Kristin" matches "Kristin Orsagos" (order-independent).
 *
 * Requires TWO tokens: a single token cannot be trusted to be a
 * distinctive surname. "Melissa" is 7 characters and shared by dozens of
 * customers, so a length heuristic does not separate "Novinski" from a
 * common first name, and a wrong auto-suggestion here points at the
 * refund buttons. Single-token lookups are still reachable through the
 * manual search box, where the operator is asserting intent.
 */
export function nameMatches(
  senderName: string | null | undefined,
  candidateName: string | null | undefined,
): boolean {
  const tokens = nameTokens(senderName);
  if (tokens.length < 2) return false;
  const cand = normalizeName(candidateName);
  if (!cand) return false;
  const candTokens = new Set(cand.split(" "));
  return tokens.every((t) => candTokens.has(t) || cand.includes(t));
}

/**
 * Full-name guesses for a sender, combining every name we saw: the From
 * display names and the names signed at the bottom of their emails.
 *
 * The point is the combination. "Dr. Mijares" alone is one token, which
 * never auto-suggests; her sign-off says "Lilia"; together they make
 * "Lilia Mijares", which matches the Stripe billing name "Lilia A.
 * Mijares" on a completely different address. Pure — unit-tested.
 */
export function mergeNameCandidates(
  headerNames: Array<string | null | undefined>,
  signatureNames: Array<string | null | undefined>,
): string[] {
  const headerToks = [...new Set(headerNames.flatMap((n) => nameTokens(n)))];
  const out: string[] = [];
  const push = (tokens: string[]) => {
    if (tokens.length < 2) return;
    const s = tokens.join(" ");
    if (!out.includes(s)) out.push(s);
  };

  // Names good enough on their own.
  for (const n of [...headerNames, ...signatureNames]) push(nameTokens(n));
  // Signature first name + whatever the header adds (usually the surname).
  for (const sig of signatureNames) {
    const sigToks = nameTokens(sig);
    if (sigToks.length === 0) continue;
    push([...sigToks, ...headerToks.filter((t) => !sigToks.includes(t))]);
  }
  return out;
}

/** PostgREST-safe fragment (same sanitisation as the thread search). */
export function sanitizeSearch(q: string): string {
  return q
    .replace(/[,()*%\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

// ---------------------------------------------------------------------------
// Index refresh

async function stripeGet<T>(path: string): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Stripe ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export interface NameIndexReport {
  chargesScanned: number;
  customersUpserted: number;
  full: boolean;
}

/**
 * Page the charge list newest-first and upsert one row per customer.
 * Incremental: starts from the newest indexed charge minus a day of
 * overlap, so a normal cron pass reads a single page.
 */
export async function refreshStripeNameIndex(): Promise<NameIndexReport> {
  const report: NameIndexReport = {
    chargesScanned: 0,
    customersUpserted: 0,
    full: false,
  };
  if (!stripeConfigured()) return report;

  const watermarkRows = await spGet<Array<{ last_charge_at: string | null }>>(
    "stripe_customer_names?select=last_charge_at&order=last_charge_at.desc.nullslast&limit=1",
  );
  const watermark = watermarkRows[0]?.last_charge_at
    ? Math.floor(new Date(watermarkRows[0].last_charge_at).getTime() / 1000) -
      86_400
    : null;
  report.full = watermark === null;

  // Newest charge wins per customer, so keep the first sighting.
  const byCustomer = new Map<string, StripeNameRow>();
  let startingAfter: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ limit: "100" });
    if (startingAfter) qs.set("starting_after", startingAfter);
    if (watermark !== null) qs.set("created[gte]", String(watermark));
    const res = await stripeGet<{ data?: ChargeLite[]; has_more?: boolean }>(
      `/charges?${qs.toString()}`,
    );
    const data = res.data ?? [];
    report.chargesScanned += data.length;
    for (const c of data) {
      const name = c.billing_details?.name?.trim() || null;
      const email =
        c.billing_details?.email?.trim() || c.receipt_email?.trim() || null;
      if (!c.customer || (!name && !email)) continue;
      if (byCustomer.has(c.customer)) continue;
      byCustomer.set(c.customer, {
        customer_id: c.customer,
        name,
        email,
        last_charge_at: new Date(c.created * 1000).toISOString(),
      });
    }
    if (!res.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }

  const rows = [...byCustomer.values()];
  // Chunked so a full backfill stays inside one request body.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((r) => ({
      ...r,
      updated_at: new Date().toISOString(),
    }));
    await spPost("stripe_customer_names", chunk, {
      onConflict: "customer_id",
      resolution: "merge",
    });
    report.customersUpserted += chunk.length;
  }
  return report;
}

// ---------------------------------------------------------------------------
// Lookup

export async function searchStripeNames(
  query: string,
  limit = 8,
): Promise<StripeNameRow[]> {
  const safe = sanitizeSearch(query);
  if (safe.length < 2) return [];
  const pat = encodeURIComponent(`*${safe}*`);
  return spGet<StripeNameRow[]>(
    `stripe_customer_names?or=(name.ilike.${pat},email.ilike.${pat})` +
      `&order=last_charge_at.desc.nullslast&limit=${limit}`,
  );
}

/**
 * Candidates for a sender we could not resolve. Queries on the most
 * distinctive token (usually the surname) and then applies the stricter
 * all-tokens rule locally.
 */
export async function suggestByName(
  senderName: string | null | undefined,
  limit = 5,
): Promise<StripeNameRow[]> {
  const tokens = nameTokens(senderName);
  if (tokens.length < 2) return []; // see nameMatches: full names only
  const probe = [...tokens].sort((a, b) => b.length - a.length)[0];
  const rows = await searchStripeNames(probe, 25);
  return rows.filter((r) => nameMatches(senderName, r.name)).slice(0, limit);
}
