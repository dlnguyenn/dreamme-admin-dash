/**
 * Clipper rev-share program — shared types, Supabase helpers, and the
 * earnings computation used by both the public /clip/[token] page and the
 * admin Clippers screen/API.
 *
 * Deal rules (confirmed 2026-07-09):
 *   - Clipper earns revshare_pct (default 20%) of NET-of-Apple proceeds:
 *     price_usd × (1 − commission% − tax%) per the RC webhook payload.
 *   - Earned on initial + renewal payments, capped 12 months after the
 *     subscriber's first attributed charge.
 *   - Each payment becomes payable 30 days after it posts, unless refunded
 *     (CANCELLATION w/ cancel_reason CUSTOMER_SUPPORT; REFUND_REVERSED undoes).
 */
import { SUPABASE_URL } from "@/lib/supabase";

const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

export const HOLDBACK_DAYS = 30;
export const REVSHARE_MONTHS_CAP = 12;

// ---------------------------------------------------------------------------
// Rows

export interface ClipperRow {
  id: string;
  name: string;
  code: string;
  facebook_page_url: string | null;
  revshare_pct: number;
  token: string;
  active: boolean;
  notes: string | null;
  created_at: string;
}

export interface ClipperVideoRow {
  id: string;
  clipper_id: string;
  url: string;
  external_id: string | null;
  platform: string;
  title: string | null;
  posted_at: string | null;
  views: number | null;
  views_updated_at: string | null;
  manual_views: number | null;
  scrape_status: string | null;
  source: string;
  active: boolean;
  created_at: string;
}

export interface RcEventRow {
  id: string;
  type: string;
  event_at: string;
  store: string | null;
  environment: string | null;
  app_user_id: string | null;
  original_app_user_id: string | null;
  product_id: string | null;
  period_type: string | null;
  transaction_id: string | null;
  original_transaction_id: string | null;
  offer_code: string | null;
  creator_code: string | null;
  clipper_id: string | null;
  price_usd: number | null;
  tax_percentage: number | null;
  commission_percentage: number | null;
  cancel_reason: string | null;
}

export interface ClipperPayoutRow {
  id: string;
  clipper_id: string;
  amount_usd: number;
  paid_at: string;
  method: string | null;
  note: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Service-role REST helpers (per-file helper convention, creatives/page.tsx)

export function clippersDbConfigured(): boolean {
  return !!SUPABASE_URL && !!SERVICE_ROLE;
}

function sbHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

export async function sbGet<T>(path: string): Promise<T> {
  if (!clippersDbConfigured()) throw new Error("Supabase env missing");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: sbHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** POST insert; pass onConflict for merge-duplicates upsert. Returns rows. */
export async function sbPost<T>(
  table: string,
  rows: unknown,
  opts?: { onConflict?: string },
): Promise<T[]> {
  if (!clippersDbConfigured()) throw new Error("Supabase env missing");
  const qs = opts?.onConflict ? `?on_conflict=${opts.onConflict}` : "";
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs}`, {
    method: "POST",
    headers: {
      ...sbHeaders(),
      Prefer: opts?.onConflict
        ? "resolution=merge-duplicates,return=representation"
        : "return=representation",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T[]>;
}

export async function sbPatch<T>(pathWithFilter: string, patch: unknown): Promise<T[]> {
  if (!clippersDbConfigured()) throw new Error("Supabase env missing");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathWithFilter}`, {
    method: "PATCH",
    headers: { ...sbHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T[]>;
}

export async function sbDelete(pathWithFilter: string): Promise<void> {
  if (!clippersDbConfigured()) throw new Error("Supabase env missing");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathWithFilter}`, {
    method: "DELETE",
    headers: sbHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Earnings computation (pure — unit-testable, no I/O)

export type TxnStatus = "pending" | "payable" | "refunded";

export interface EarningTxn {
  transactionId: string;
  originalTransactionId: string | null;
  type: string; // INITIAL_PURCHASE | RENEWAL | NON_RENEWING_PURCHASE
  eventAt: string;
  priceUsd: number;
  netUsd: number;
  earningUsd: number;
  status: TxnStatus;
  /** days until payable (only when pending) */
  daysLeft?: number;
}

export interface EarningsSummary {
  txns: EarningTxn[];
  conversions: number; // distinct subscribers (original_transaction_id)
  grossUsd: number; // non-refunded attributed gross
  netUsd: number; // non-refunded attributed net
  pendingUsd: number;
  payableUsd: number;
  paidUsd: number;
  balanceUsd: number; // payable − paid
}

const PAID_TYPES = new Set(["INITIAL_PURCHASE", "RENEWAL", "NON_RENEWING_PURCHASE"]);

/**
 * Net proceeds per transaction. RC sends commission_percentage /
 * tax_percentage as fractions (e.g. 0.30) per docs — the `> 1` guard converts
 * if a real payload ever arrives percent-style (isolated here on purpose).
 */
function netOfStore(price: number, commission: number | null, tax: number | null): number {
  const norm = (v: number | null, fallback: number) => {
    if (v == null || !Number.isFinite(v)) return fallback;
    return v > 1 ? v / 100 : v;
  };
  const c = norm(commission, 0.3);
  const t = norm(tax, 0);
  return price * Math.max(0, 1 - c - t);
}

export function computeEarnings(
  events: RcEventRow[],
  revsharePct: number,
  payouts: Pick<ClipperPayoutRow, "amount_usd">[],
  now: Date = new Date(),
): EarningsSummary {
  const nowMs = now.getTime();
  const holdbackMs = HOLDBACK_DAYS * 86_400_000;

  // Candidate paid transactions: production, real money, deduped by txn id
  // (RC may re-deliver; latest event wins).
  const byTxn = new Map<string, RcEventRow>();
  for (const e of events) {
    if (!PAID_TYPES.has(e.type)) continue;
    if ((e.environment ?? "PRODUCTION") !== "PRODUCTION") continue;
    const price = Number(e.price_usd) || 0;
    if (price <= 0) continue; // trials & zero-price
    const key = e.transaction_id ?? e.id;
    const prev = byTxn.get(key);
    if (!prev || e.event_at > prev.event_at) byTxn.set(key, e);
  }

  // Refunds: CANCELLATION w/ CUSTOMER_SUPPORT voids the LATEST paid txn on
  // that subscription (RC only fires for latest-period refunds); a later
  // REFUND_REVERSED on the same subscription clears it.
  const refundedOrigTxns = new Map<string, string>(); // orig_txn_id -> refund event_at
  for (const e of events) {
    const orig = e.original_transaction_id;
    if (!orig) continue;
    if (e.type === "CANCELLATION" && e.cancel_reason === "CUSTOMER_SUPPORT") {
      const prev = refundedOrigTxns.get(orig);
      if (!prev || e.event_at > prev) refundedOrigTxns.set(orig, e.event_at);
    }
  }
  for (const e of events) {
    const orig = e.original_transaction_id;
    if (!orig) continue;
    if (e.type === "REFUND_REVERSED") {
      const refundAt = refundedOrigTxns.get(orig);
      if (refundAt && e.event_at > refundAt) refundedOrigTxns.delete(orig);
    }
  }

  // First attributed charge per subscription → 12-month eligibility window.
  const firstChargeAt = new Map<string, string>();
  for (const e of byTxn.values()) {
    const orig = e.original_transaction_id ?? e.transaction_id ?? e.id;
    const prev = firstChargeAt.get(orig);
    if (!prev || e.event_at < prev) firstChargeAt.set(orig, e.event_at);
  }

  const txns: EarningTxn[] = [];
  let pendingUsd = 0;
  let payableUsd = 0;
  let grossUsd = 0;
  let netTotalUsd = 0;

  for (const e of byTxn.values()) {
    const orig = e.original_transaction_id ?? e.transaction_id ?? e.id;

    // 12-month cap from the subscriber's first attributed charge.
    const first = firstChargeAt.get(orig) ?? e.event_at;
    const capMs =
      new Date(first).getTime() + REVSHARE_MONTHS_CAP * 30.44 * 86_400_000;
    if (new Date(e.event_at).getTime() > capMs) continue;

    const price = Number(e.price_usd) || 0;
    const net = netOfStore(price, e.commission_percentage, e.tax_percentage);
    const earning = (net * revsharePct) / 100;

    // Refund heuristic: void the latest paid txn on a refunded subscription.
    const refundAt = refundedOrigTxns.get(orig);
    const latestPaidOnSub = [...byTxn.values()]
      .filter((x) => (x.original_transaction_id ?? x.transaction_id ?? x.id) === orig)
      .sort((a, b) => (a.event_at < b.event_at ? 1 : -1))[0];
    const isRefunded = !!refundAt && latestPaidOnSub === e;

    const eventMs = new Date(e.event_at).getTime();
    let status: TxnStatus;
    let daysLeft: number | undefined;
    if (isRefunded) {
      status = "refunded";
    } else if (eventMs + holdbackMs > nowMs) {
      status = "pending";
      daysLeft = Math.max(1, Math.ceil((eventMs + holdbackMs - nowMs) / 86_400_000));
    } else {
      status = "payable";
    }

    if (status !== "refunded") {
      grossUsd += price;
      netTotalUsd += net;
      if (status === "pending") pendingUsd += earning;
      else payableUsd += earning;
    }

    txns.push({
      transactionId: e.transaction_id ?? e.id,
      originalTransactionId: e.original_transaction_id,
      type: e.type,
      eventAt: e.event_at,
      priceUsd: price,
      netUsd: net,
      earningUsd: earning,
      status,
      ...(daysLeft != null ? { daysLeft } : {}),
    });
  }

  txns.sort((a, b) => (a.eventAt < b.eventAt ? 1 : -1));
  const paidUsd = payouts.reduce((s, p) => s + (Number(p.amount_usd) || 0), 0);
  const conversions = new Set(
    txns.filter((t) => t.status !== "refunded").map((t) => t.originalTransactionId ?? t.transactionId),
  ).size;

  return {
    txns,
    conversions,
    grossUsd,
    netUsd: netTotalUsd,
    pendingUsd,
    payableUsd,
    paidUsd,
    balanceUsd: payableUsd - paidUsd,
  };
}

// ---------------------------------------------------------------------------
// Composite loaders

export interface ClipperBundle {
  clipper: ClipperRow;
  videos: ClipperVideoRow[];
  earnings: EarningsSummary;
  totalViews: number;
  payouts: ClipperPayoutRow[];
}

export function effectiveViews(v: Pick<ClipperVideoRow, "views" | "manual_views">): number {
  return Number(v.views ?? v.manual_views ?? 0) || 0;
}

export async function loadClipperBundle(clipper: ClipperRow): Promise<ClipperBundle> {
  const [videos, events, payouts] = await Promise.all([
    sbGet<ClipperVideoRow[]>(
      `clipper_videos?clipper_id=eq.${clipper.id}&active=eq.true&order=posted_at.desc.nullslast,created_at.desc&limit=500`,
    ),
    sbGet<RcEventRow[]>(
      `rc_events?clipper_id=eq.${clipper.id}&order=event_at.asc&limit=10000`,
    ),
    sbGet<ClipperPayoutRow[]>(
      `clipper_payouts?clipper_id=eq.${clipper.id}&order=paid_at.desc&limit=500`,
    ),
  ]);
  const earnings = computeEarnings(events, Number(clipper.revshare_pct) || 20, payouts);
  const totalViews = videos.reduce((s, v) => s + effectiveViews(v), 0);
  return { clipper, videos, earnings, totalViews, payouts };
}
