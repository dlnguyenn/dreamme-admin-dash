/**
 * Support Inbox — read-only access to the CONSUMER app's Supabase project
 * (users + in-app feedback). Separate project from the dashboard's internal
 * Supabase; configured via CONSUMER_SUPABASE_URL / CONSUMER_SERVICE_ROLE_KEY.
 */
import {
  PAGE_SIZE,
  countFromContentRange,
  fetchAllPages,
} from "@/lib/pagedFetch";

const CONSUMER_URL = process.env.CONSUMER_SUPABASE_URL ?? "";
const CONSUMER_KEY = process.env.CONSUMER_SERVICE_ROLE_KEY ?? "";

export function consumerDbConfigured(): boolean {
  return !!CONSUMER_URL && !!CONSUMER_KEY;
}

function headers(): Record<string, string> {
  return {
    apikey: CONSUMER_KEY,
    Authorization: `Bearer ${CONSUMER_KEY}`,
    "Content-Type": "application/json",
  };
}

async function cGet<T>(path: string): Promise<T> {
  if (!consumerDbConfigured()) throw new Error("Consumer Supabase env missing");
  const res = await fetch(`${CONSUMER_URL}/rest/v1/${path}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `Consumer Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return res.json() as Promise<T>;
}

export interface ConsumerUserRow {
  id: string; // uuid — equals the RevenueCat app_user_id
  email: string | null;
  /** Always null in practice — see USER_SELECT. Use displayName. */
  name: string | null;
  display_name: string | null;
  glp1_journey_stage: string | null;
}

/**
 * `users.name` is null for every row (37,208/37,208 as of 2026-08-01) —
 * reading it is why the support sidebar showed "Name —" for everyone.
 * `display_name` is populated for ~99%, so select both and prefer it.
 * Note it is usually a FIRST name only, which is why it is not a
 * reliable key for matching a full name off an email header.
 */
const USER_SELECT = "id,email,name,display_name,glp1_journey_stage";

/** Best human name we have for a consumer user. */
export function userDisplayName(row: ConsumerUserRow | null): string | null {
  const pick = row?.display_name?.trim() || row?.name?.trim() || "";
  return pick || null;
}

export async function findUserByEmail(
  email: string,
): Promise<ConsumerUserRow | null> {
  const cleaned = email.trim().toLowerCase();
  if (!cleaned) return null;
  // PostgREST ilike with the literal address (escape reserved chars via
  // encodeURIComponent; % wildcards deliberately NOT added — exact match,
  // case-insensitive).
  const rows = await cGet<ConsumerUserRow[]>(
    `users?select=${USER_SELECT}&email=ilike.${encodeURIComponent(cleaned)}&limit=2`,
  );
  return rows[0] ?? null;
}

export async function getUserById(id: string): Promise<ConsumerUserRow | null> {
  const rows = await cGet<ConsumerUserRow[]>(
    `users?select=${USER_SELECT}&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows[0] ?? null;
}

export interface ReferralSourceRow {
  /** join key: equals rc_events.app_user_id in the internal project */
  id: string;
  joined_at: string;
  /** null when the user skipped the "how did you hear about us?" step. */
  referral_source: string | null;
}

function referralPath(sinceIso: string, offset: number): string {
  return (
    `users?select=id,joined_at,referral_source` +
    `&joined_at=gte.${encodeURIComponent(sinceIso)}` +
    `&order=joined_at.asc&limit=${PAGE_SIZE}&offset=${offset}`
  );
}

/** Exact row count for the window, without transferring rows. */
export async function countReferralSourcesSince(
  sinceIso: string,
): Promise<number | null> {
  if (!consumerDbConfigured()) throw new Error("Consumer Supabase env missing");
  const res = await fetch(
    `${CONSUMER_URL}/rest/v1/users?select=id` +
      `&joined_at=gte.${encodeURIComponent(sinceIso)}`,
    {
      method: "HEAD",
      headers: { ...headers(), Prefer: "count=exact", Range: "0-0" },
      cache: "no-store",
    },
  );
  if (!res.ok) return null;
  return countFromContentRange(res.headers.get("content-range"));
}

/** Signup rows since `sinceIso`, for the Overview's attribution panel. */
export async function fetchReferralSourcesSince(
  sinceIso: string,
): Promise<ReferralSourceRow[]> {
  return fetchAllPages<ReferralSourceRow>({
    count: () => countReferralSourcesSince(sinceIso),
    page: (offset) => cGet<ReferralSourceRow[]>(referralPath(sinceIso, offset)),
  });
}

export interface ConsumerAuthInfo {
  createdAt: string | null;
  lastSignInAt: string | null;
}

/**
 * Account age + last sign-in from the Supabase auth admin API — the public
 * users table has no created_at, but GoTrue does.
 */
export async function getAuthInfo(userId: string): Promise<ConsumerAuthInfo | null> {
  if (!consumerDbConfigured()) return null;
  try {
    const res = await fetch(
      `${CONSUMER_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      { headers: headers(), cache: "no-store" },
    );
    if (!res.ok) return null;
    const d = (await res.json()) as {
      created_at?: string;
      last_sign_in_at?: string;
    };
    return {
      createdAt: d.created_at ?? null,
      lastSignInAt: d.last_sign_in_at ?? null,
    };
  } catch {
    return null;
  }
}

export interface ConsumerSubscriptionRow {
  store: string | null; // app_store | play_store | stripe
  product_id: string | null;
  plan: string | null; // yearly | quarterly | monthly | weekly | …
  status: string | null;
  is_trial: boolean | null;
  price: number | null;
  currency: string | null;
  purchased_at: string | null;
  original_purchased_at: string | null;
  expires_at: string | null;
  auto_renew: boolean | null;
  total_spent: number | null;
  total_renewals: number | null;
}

/** RC-webhook-fed subscription rows (authoritative plan / trial flags). */
export async function fetchConsumerSubscriptions(
  rcAppUserId: string,
): Promise<ConsumerSubscriptionRow[]> {
  return cGet<ConsumerSubscriptionRow[]>(
    `subscriptions?rc_app_user_id=eq.${encodeURIComponent(rcAppUserId)}` +
      `&select=store,product_id,plan,status,is_trial,price,currency,purchased_at,original_purchased_at,expires_at,auto_renew,total_spent,total_renewals`,
  );
}

export interface ConsumerFeedbackRow {
  id: string;
  user_id: string | null;
  user_name: string | null;
  user_created_at: string | null;
  subscription_status: string | null;
  category: string | null;
  message: string;
  created_at: string;
  platform: string | null;
  reply_email: string | null;
  image_urls: string[] | null;
}

export async function fetchFeedbackSince(
  sinceIso: string,
): Promise<ConsumerFeedbackRow[]> {
  return cGet<ConsumerFeedbackRow[]>(
    `feedback?select=*&created_at=gt.${encodeURIComponent(sinceIso)}&order=created_at.asc&limit=200`,
  );
}
