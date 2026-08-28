/**
 * RevenueCat webhook ingest — captures every subscription-lifecycle event
 * into rc_events, resolving clipper attribution as events arrive.
 *
 * Setup (RC dashboard → Project → Integrations → Webhooks):
 *   URL:            https://<dash-host>/api/ingest/rc-webhook
 *   Authorization:  the exact value of RC_WEBHOOK_SECRET
 *
 * Attribution:
 *   1. subscriber_attributes.creator_code (set by the iOS app's creator-code
 *      field) — matched case-insensitively against clippers.code.
 *      offer_code is honored as a fallback key (harmless, future-proof).
 *   2. Renewals rarely re-carry the code, so events inherit clipper_id from
 *      any earlier attributed event on the same original_transaction_id.
 *
 * We store ALL lifecycle events (attributed or not): unattributed rows make
 * retroactive repair possible, and CANCELLATION/REFUND events double as the
 * per-transaction refund-timestamp record the analytics side never had.
 *
 * Auth: static Authorization-header compare via safeStringEq. Deliberately
 * NOT checkIngestAuth — its same-origin fallback is spoofable and this route
 * is internet-facing.
 */
import { NextResponse } from "next/server";
import { safeStringEq } from "@/lib/mcp-oauth";
import { sbGet, sbPost, clippersDbConfigured, type ClipperRow } from "@/lib/clippers";
import {
  isTrialConversionRenewal,
  mapRcEventToTikTok,
  payloadHash,
} from "@/lib/tiktok/mapEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Headroom over the platform default: the handler makes up to four Supabase
// round-trips (clipper lookup, upsert, renewal siblings, outbox insert). It
// never calls TikTok — that's the drain cron's job.
export const maxDuration = 30;

const WEBHOOK_SECRET = process.env.RC_WEBHOOK_SECRET ?? "";

/** Event types we don't need (paywall views, experiment noise). */
const SKIP_TYPES = new Set(["TEST"]);

interface RcWebhookEvent {
  id?: string;
  type?: string;
  event_timestamp_ms?: number;
  purchased_at_ms?: number;
  expiration_at_ms?: number;
  store?: string;
  environment?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  product_id?: string;
  period_type?: string;
  transaction_id?: string;
  original_transaction_id?: string;
  offer_code?: string | null;
  price?: number;
  price_in_purchased_currency?: number;
  currency?: string;
  tax_percentage?: number | null;
  commission_percentage?: number | null;
  cancel_reason?: string;
  subscriber_attributes?: Record<string, { value?: unknown } | undefined>;
}

function extractCreatorCode(ev: RcWebhookEvent): string | null {
  // The iOS app (1.3.9 creator-referral system) sets
  // subscriber_attributes.referral_code. `creator_code` kept as a fallback
  // for any legacy events; offer_code last. Codes are stored UPPERCASE.
  const attrs = ev.subscriber_attributes ?? {};
  for (const key of ["referral_code", "creator_code"]) {
    const v = attrs[key]?.value;
    if (typeof v === "string" && v.trim()) return v.trim().toUpperCase();
  }
  if (typeof ev.offer_code === "string" && ev.offer_code.trim()) {
    return ev.offer_code.trim().toUpperCase();
  }
  return null;
}

function extractInstallId(ev: RcWebhookEvent): string | null {
  // Set by the app's attribution SDK (lib/attribution/installAttribution.ts,
  // Purchases.setAttributes({ dm_install_id })) — joins this revenue event to
  // attr_installs/attr_clicks for ad-level attribution. Same extraction
  // pattern as creator_code above.
  const v = (ev.subscriber_attributes ?? {})["dm_install_id"]?.value;
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 64) : null;
}

async function resolveClipperId(
  creatorCode: string | null,
  originalTransactionId: string | null,
): Promise<string | null> {
  if (creatorCode) {
    const rows = await sbGet<Pick<ClipperRow, "id">[]>(
      `clippers?code=eq.${encodeURIComponent(creatorCode)}&select=id&limit=1`,
    );
    if (rows[0]) return rows[0].id;
  }
  if (originalTransactionId) {
    const rows = await sbGet<{ clipper_id: string | null }[]>(
      `rc_events?original_transaction_id=eq.${encodeURIComponent(originalTransactionId)}` +
        `&clipper_id=not.is.null&select=clipper_id&limit=1`,
    );
    if (rows[0]?.clipper_id) return rows[0].clipper_id;
  }
  return null;
}

export async function POST(req: Request) {
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ error: "RC_WEBHOOK_SECRET not configured" }, { status: 503 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!safeStringEq(auth, WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!clippersDbConfigured()) {
    return NextResponse.json({ error: "supabase not configured" }, { status: 503 });
  }

  let body: { event?: RcWebhookEvent };
  try {
    body = (await req.json()) as { event?: RcWebhookEvent };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const ev = body.event;
  if (!ev?.id || !ev.type) {
    // Acknowledge malformed/unknown shapes so RC doesn't retry forever.
    return NextResponse.json({ ok: true, skipped: "no event" });
  }
  if (SKIP_TYPES.has(ev.type)) {
    return NextResponse.json({ ok: true, skipped: ev.type });
  }

  const creatorCode = extractCreatorCode(ev);
  let clipperId: string | null = null;
  try {
    clipperId = await resolveClipperId(creatorCode, ev.original_transaction_id ?? null);
  } catch {
    // Attribution lookup failure must not drop the event — store unattributed.
    clipperId = null;
  }

  const toIso = (ms?: number) => (ms && Number.isFinite(ms) ? new Date(ms).toISOString() : null);
  // Paid events: event_at = the CHARGE date (starts the 30-day holdback clock).
  // Everything else (CANCELLATION, REFUND_REVERSED, …): when the event happened,
  // so refund-vs-reversal ordering in computeEarnings stays correct.
  const PAID_TYPES = new Set(["INITIAL_PURCHASE", "RENEWAL", "NON_RENEWING_PURCHASE"]);
  const eventAt = PAID_TYPES.has(ev.type)
    ? toIso(ev.purchased_at_ms) ?? toIso(ev.event_timestamp_ms)
    : toIso(ev.event_timestamp_ms);
  const row = {
    id: ev.id,
    type: ev.type,
    event_at: eventAt ?? new Date().toISOString(),
    store: ev.store ?? null,
    environment: ev.environment ?? null,
    app_user_id: ev.app_user_id ?? null,
    original_app_user_id: ev.original_app_user_id ?? null,
    product_id: ev.product_id ?? null,
    period_type: ev.period_type ?? null,
    transaction_id: ev.transaction_id ?? null,
    original_transaction_id: ev.original_transaction_id ?? null,
    offer_code: ev.offer_code ?? null,
    creator_code: creatorCode,
    dm_install_id: extractInstallId(ev),
    clipper_id: clipperId,
    price_usd: ev.price ?? null,
    price_in_purchased_currency: ev.price_in_purchased_currency ?? null,
    currency: ev.currency ?? null,
    tax_percentage: ev.tax_percentage ?? null,
    commission_percentage: ev.commission_percentage ?? null,
    cancel_reason: ev.cancel_reason ?? null,
    expiration_at: toIso(ev.expiration_at_ms),
    raw: body,
  };

  try {
    await sbPost("rc_events", [row], { onConflict: "id" });
  } catch (e) {
    // Non-2xx makes RC retry with backoff — that's what we want on DB errors.
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const queued = await enqueueTikTokEvent(row);

  return NextResponse.json({ ok: true, attributed: !!clipperId, tiktok: queued });
}

/**
 * Queue the TikTok Events API mirror of this event.
 *
 * We insert into the outbox and let /api/cron/drain-tiktok-events do the HTTP —
 * calling TikTok from here would either be lost when Vercel freezes the
 * function (fire-and-forget) or trade away RC's retry for nothing (awaited but
 * swallowed). The outbox PK is the event_id, so an RC redelivery is a no-op.
 */
async function enqueueTikTokEvent(row: {
  id: string;
  type: string;
  event_at: string;
  store: string | null;
  environment: string | null;
  product_id: string | null;
  period_type: string | null;
  price_usd: number | null;
  price_in_purchased_currency: number | null;
  currency: string | null;
  original_transaction_id: string | null;
  raw: unknown;
}): Promise<string> {
  const appStoreId = process.env.TIKTOK_APP_STORE_ID ?? "";
  if (!appStoreId) return "not_configured";
  try {
    // RC has no TRIAL_CONVERTED on this project — the trial->paid conversion is
    // the FIRST renewal of a subscription that began as a trial. Deciding that
    // needs the event's siblings, so resolve it here where we have DB access.
    let isTrialConversion = false;
    if (row.type === "RENEWAL" && row.store === "APP_STORE" && row.original_transaction_id) {
      const siblings = await sbGet<
        { type: string; period_type: string | null; event_at: string }[]
      >(
        `rc_events?original_transaction_id=eq.${encodeURIComponent(row.original_transaction_id)}` +
          `&select=type,period_type,event_at&limit=200`,
      );
      isTrialConversion = isTrialConversionRenewal(row, siblings);
    }

    const mapped = mapRcEventToTikTok({ ...row, isTrialConversion }, { appStoreId });
    if (!mapped) return "not_reportable";
    await sbPost(
      "tiktok_event_outbox",
      [
        {
          event_id: mapped.eventId,
          rc_event_id: row.id,
          event_name: mapped.eventName,
          event_time: mapped.eventTime,
          status: "pending",
          payload_sha256: payloadHash(mapped.payload),
          summary: mapped.summary,
        },
      ],
      { onConflict: "event_id", ignoreDuplicates: true },
    );
    return mapped.eventName;
  } catch (e) {
    // rc_events is already stored; never fail the webhook over the mirror.
    console.error("tiktok outbox enqueue failed", (e as Error).message);
    return "enqueue_failed";
  }
}
