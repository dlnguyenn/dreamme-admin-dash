/**
 * trial_qualified → Meta Conversions API: the pure decision + payload logic.
 * The route (src/app/api/cron/capi-trial-qualified) is the I/O shell.
 *
 * Replaces the n8n "Meta Ads Qualified Trial Event Fire" workflow
 * (wEZAcV8qNd0OTUBQ), which died on 2026-07-06. Same rule: a trial is
 * qualified when, 2h after it starts, RevenueCat still shows the store
 * subscription trialing/active and set to renew. Unlike n8n this covers
 * Play trials too, and sends action_source "website" so a web-objective
 * (redirect) campaign can optimize on it. Whether server-sent app-sourced
 * custom events land in dataset 1777837186267557 is unverified: outlier's
 * attr-capi saw them dropped (2026-09-22), yet trial_engaged shows 1.3K/28d
 * in Events Manager (its SDK copy may account for that). The Graph
 * /{dataset}/stats endpoint undercounts; check Events Manager instead.
 */
import { createHash } from "node:crypto";

export const QUALIFY_DELAY_MS = 2 * 60 * 60 * 1000;

/** The dataset's only observed host; outlier's attr-capi uses the same. */
export const EVENT_SOURCE_URL = "https://go.dreamme.life/l";

export type RcStore = "APP_STORE" | "PLAY_STORE";

export interface TrialRow {
  original_transaction_id: string;
  app_user_id: string;
  store: RcStore;
  event_at: string;
  product_id: string | null;
  /** rc_events.raw->event->subscriber_attributes */
  attrs: Record<string, { value?: string | null } | undefined> | null;
}

export interface SubscriptionLike {
  store: string;
  status: string;
  auto_renewal_status: string | null;
}

export type Decision = "qualified" | "not_renewing" | "no_rc_subscription";

const V2_STORE: Record<RcStore, string> = {
  APP_STORE: "app_store",
  PLAY_STORE: "play_store",
};

// will_change_product = still renewing, just onto another plan.
const RENEWING = new Set(["will_renew", "will_change_product"]);
const LIVE = new Set(["trialing", "active"]);

/** Trials become decidable once QUALIFY_DELAY_MS has passed since start. */
export function isDue(t: Pick<TrialRow, "event_at">, now: number): boolean {
  return now - Date.parse(t.event_at) >= QUALIFY_DELAY_MS;
}

export function decide(store: RcStore, subs: SubscriptionLike[]): Decision {
  const mine = subs.filter((s) => s.store === V2_STORE[store]);
  if (!mine.length) return "no_rc_subscription";
  const renewing = mine.some(
    (s) => LIVE.has(s.status) && RENEWING.has(s.auto_renewal_status ?? ""),
  );
  return renewing ? "qualified" : "not_renewing";
}

const attr = (t: TrialRow, key: string): string | null => {
  const v = t.attrs?.[key]?.value;
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

export interface MatchKeys {
  email: string | null;
  ip: string | null;
  ua: string | null;
}

/** RevenueCat attributes first (set by the app for ~every trial), then the
 *  install registry's server-observed ip/ua. */
export function matchKeys(
  t: TrialRow,
  install: { ip: string | null; ua: string | null } | undefined,
): MatchKeys {
  return {
    email: attr(t, "$email"),
    ip: attr(t, "$ip") ?? install?.ip ?? null,
    ua: install?.ua ?? null,
  };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface CapiEvent {
  event_name: "trial_qualified";
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url: string;
  user_data: {
    em?: string[];
    external_id: string[];
    client_ip_address?: string;
    client_user_agent?: string;
  };
  custom_data: {
    platform: "ios" | "android";
    product_id: string | null;
  };
}

export function buildEvent(t: TrialRow, keys: MatchKeys): CapiEvent {
  const user_data: CapiEvent["user_data"] = {
    // external_id has no normalization rules; hash as-is (matches attr-capi)
    external_id: [sha256(t.app_user_id.trim())],
  };
  if (keys.email) user_data.em = [sha256(keys.email.toLowerCase())];
  if (keys.ip) user_data.client_ip_address = keys.ip;
  if (keys.ua) user_data.client_user_agent = keys.ua;
  return {
    event_name: "trial_qualified",
    // the qualification point itself, so backfilled runs keep true timing
    event_time: Math.floor((Date.parse(t.event_at) + QUALIFY_DELAY_MS) / 1000),
    event_id: `trial_qualified_${t.original_transaction_id}`,
    action_source: "website",
    event_source_url: EVENT_SOURCE_URL,
    user_data,
    custom_data: {
      platform: t.store === "PLAY_STORE" ? "android" : "ios",
      product_id: t.product_id,
    },
  };
}
