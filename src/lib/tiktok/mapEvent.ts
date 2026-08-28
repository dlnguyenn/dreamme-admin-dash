/**
 * RevenueCat lifecycle event -> TikTok Events API 2.0 app event.
 *
 * Pure (no I/O) so the whole mapping is unit-testable — see
 * tests/tiktok-map-event.test.ts.
 *
 * Matching reality, so nobody reads the dashboards wrong later: IDFV is
 * vendor-scoped, so TikTok has never observed it and it does NOT match — we
 * send it only to future-proof a possible SDK. Real matching rests on hashed
 * email (~44% of ours are Apple private-relay and unmatchable) and IDFA
 * (ATT-authorized only, ~18%). This integration buys verification, modeled
 * conversions, and audience seeding — not deterministic attribution.
 *
 * Docs: https://business-api.tiktok.com/portal/docs/setup-guide-for-app/v1.3
 */
import { createHash } from "node:crypto";
import { hashEmailForMeta } from "@/lib/vendors/meta-ads";

/** Standard TikTok app events we report. Custom events aren't optimizable. */
export type TikTokAppEvent = "StartTrial" | "Subscribe";

/** The subset of an rc_events row (plus its raw webhook) the mapper reads. */
export interface RcEventInput {
  id: string;
  type: string;
  event_at: string;
  store: string | null;
  environment: string | null;
  product_id: string | null;
  period_type: string | null;
  price_usd: number | null;
  price_in_purchased_currency?: number | null;
  currency: string | null;
  original_transaction_id?: string | null;
  /** The full webhook body we stored, i.e. { event: { subscriber_attributes } }. */
  raw: unknown;
  /**
   * Set by the caller for RENEWAL rows: is this the first paid period after a
   * free trial (i.e. the trial->paid conversion) rather than a recurring
   * renewal? Requires a DB lookup, so it's resolved outside this pure mapper —
   * see isTrialConversionRenewal().
   */
  isTrialConversion?: boolean;
}

export interface TikTokUser {
  email?: string;
  idfa?: string;
  idfv?: string;
  ip?: string;
  att_status: string;
}

export interface TikTokEventPayload {
  event: TikTokAppEvent;
  event_time: number;
  event_id: string;
  user: TikTokUser;
  app: { app_id: string; app_name: string };
  properties: Record<string, unknown>;
}

export interface MappedTikTokEvent {
  eventId: string;
  eventName: TikTokAppEvent;
  eventTime: string;
  payload: TikTokEventPayload;
  summary: Record<string, unknown>;
}

/**
 * Only App Store purchases belong on an *app* data source. Stripe rows are web
 * checkouts (different data source, event_source "web"); Play is the Android
 * app's own data source. Allowlist rather than denylist — RC also emits
 * PROMOTIONAL, RC_BILLING, MAC_APP_STORE, AMAZON, PADDLE.
 */
const ALLOWED_STORE = "APP_STORE";

/**
 * TRANSFER/PRODUCT_CHANGE move a subscription between users or SKUs; treating
 * them as conversions manufactures phantom events.
 */
const IGNORED_TYPES = new Set(["TRANSFER", "PRODUCT_CHANGE", "TEST"]);

const ZERO_IDFA = "00000000-0000-0000-0000-000000000000";

function attrValue(raw: unknown, key: string): string | null {
  const attrs = (raw as { event?: { subscriber_attributes?: Record<string, { value?: unknown }> } })
    ?.event?.subscriber_attributes;
  const v = attrs?.[key]?.value;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * TikTok's att_status enum from RC's lowercase $attConsentStatus.
 *
 * Two defaults would be wrong and both are avoided: NOT_APPLICABLE means "this
 * platform has no ATT" (Android / iOS < 14) and would be a false statement for
 * our users; blanket DENIED would throw away matching on the ~42% of events
 * where RC never captured the attribute. A real IDFA can only exist when the
 * user authorized, so its presence resolves the missing case.
 */
export function resolveAttStatus(rcStatus: string | null, hasRealIdfa: boolean): string {
  switch ((rcStatus ?? "").toLowerCase()) {
    case "authorized":
      return "AUTHORIZED";
    case "denied":
      return "DENIED";
    case "restricted":
      return "RESTRICTED";
    case "notdetermined":
      return "NOT_DETERMINED";
    default:
      return hasRealIdfa ? "AUTHORIZED" : "NOT_DETERMINED";
  }
}

function buildUser(raw: unknown, includeIp: boolean): TikTokUser {
  const rawIdfa = attrValue(raw, "$idfa");
  const hasRealIdfa = !!rawIdfa && rawIdfa !== ZERO_IDFA;
  const att = resolveAttStatus(attrValue(raw, "$attConsentStatus"), hasRealIdfa);

  const user: TikTokUser = { att_status: att };

  // An all-zeros IDFA burns a match slot on a value we know is garbage, and a
  // real IDFA can't legitimately accompany a non-AUTHORIZED status.
  if (hasRealIdfa && att === "AUTHORIZED") user.idfa = rawIdfa!.toUpperCase();

  const idfv = attrValue(raw, "$idfv");
  if (idfv) user.idfv = idfv;

  // Under DENIED, TikTok ignores PII for user-level matching, so sending the
  // email hash is pure PII surface with no upside.
  const email = attrValue(raw, "$email");
  if (email && att !== "DENIED") user.email = hashEmailForMeta(email);

  // $ip is last-seen, not event-time. Safe on the events where the device was
  // demonstrably present; a recycled/carrier-NAT IP on a later event can
  // mis-match a different TikTok user.
  if (includeIp) {
    const ip = attrValue(raw, "$ip");
    if (ip) user.ip = ip;
  }

  // Deliberately not set: locale and user_agent (absent from RC's payload —
  // don't fabricate) and limited_data_use (ATT-denied is not a CCPA opt-out;
  // wire this to a real "Do Not Sell" toggle if we ever ship one).
  return user;
}

/** RC type + period -> TikTok standard event, or null if we don't report it. */
function chooseEvent(row: RcEventInput): TikTokAppEvent | null {
  const period = (row.period_type ?? "").toUpperCase();
  if (row.type === "INITIAL_PURCHASE") return period === "TRIAL" ? "StartTrial" : "Subscribe";
  // RevenueCat does not emit TRIAL_CONVERTED on this project (verified: zero
  // rows in 60 days). The trial->paid conversion arrives as the FIRST RENEWAL
  // on the subscription, a median 7.00 days after the trial start — exactly the
  // trial length. So that renewal is our real Subscribe signal.
  if (row.type === "TRIAL_CONVERTED") return "Subscribe";
  if (row.type === "RENEWAL") return row.isTrialConversion ? "Subscribe" : null;
  // Recurring renewals stay unreported: they fire weeks-to-months after the
  // click, outside every attribution window, so feeding them to an optimizable
  // event would poison bidding and inflate reported ROAS. If renewal revenue is
  // wanted later, send it as a CUSTOM event, which TikTok cannot optimize on.
  return null;
}

/**
 * Is this RENEWAL the trial->paid conversion? True when the subscription began
 * as a trial and this is its first renewal. Needs the event's siblings, so the
 * caller supplies them (from rc_events, same original_transaction_id).
 */
export function isTrialConversionRenewal(
  row: { type: string; event_at: string },
  siblings: Array<{ type: string; period_type: string | null; event_at: string }>,
): boolean {
  if (row.type !== "RENEWAL") return false;
  const startedOnTrial = siblings.some(
    (s) => s.type === "INITIAL_PURCHASE" && (s.period_type ?? "").toUpperCase() === "TRIAL",
  );
  if (!startedOnTrial) return false;
  const thisAt = Date.parse(row.event_at);
  const earlierRenewal = siblings.some(
    (s) => s.type === "RENEWAL" && Date.parse(s.event_at) < thisAt,
  );
  return !earlierRenewal;
}

export function mapRcEventToTikTok(
  row: RcEventInput,
  cfg: { appStoreId: string; appName?: string },
): MappedTikTokEvent | null {
  if (IGNORED_TYPES.has(row.type)) return null;
  if ((row.store ?? "") !== ALLOWED_STORE) return null;
  if ((row.environment ?? "").toUpperCase() === "SANDBOX") return null;

  const eventName = chooseEvent(row);
  if (!eventName) return null;

  const eventTimeMs = Date.parse(row.event_at);
  if (!Number.isFinite(eventTimeMs)) return null;

  const user = buildUser(row.raw, true);

  const properties: Record<string, unknown> = { content_type: "product" };
  if (row.product_id) {
    properties.content_id = row.product_id;
    properties.description = row.product_id;
  }

  if (eventName === "StartTrial") {
    // No value/currency at all on a $0 trial. A per-plan constant would
    // double-count against the later Subscribe in TikTok's reported conversion
    // value and gives value-based bidding nothing it can't already infer.
    properties.customer_type = "new";
  } else {
    const value = row.price_in_purchased_currency ?? row.price_usd ?? null;
    const currency = row.price_in_purchased_currency != null ? row.currency : "USD";
    if (value != null && value > 0 && currency) {
      properties.value = value;
      properties.currency = currency;
      if (row.product_id) {
        properties.contents = [{ content_id: row.product_id, price: value, quantity: 1 }];
      }
    }
    // A trial conversion is still this customer's first payment.
    properties.customer_type =
      row.type === "INITIAL_PURCHASE" || row.isTrialConversion ? "new" : "returning";
  }

  const eventId = `${row.id}:${eventName}`;
  const payload: TikTokEventPayload = {
    event: eventName,
    event_time: Math.floor(eventTimeMs / 1000),
    event_id: eventId,
    user,
    app: { app_id: cfg.appStoreId, app_name: cfg.appName ?? "DreamMe" },
    properties,
  };

  return {
    eventId,
    eventName,
    eventTime: new Date(eventTimeMs).toISOString(),
    payload,
    summary: {
      att_status: user.att_status,
      had_idfa: !!user.idfa,
      had_email: !!user.email,
      had_ip: !!user.ip,
      product_id: row.product_id,
      value: properties.value ?? null,
      currency: properties.currency ?? null,
    },
  };
}

export function payloadHash(payload: TikTokEventPayload): string {
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}
