/**
 * Support Inbox — read-only access to the CONSUMER app's Supabase project
 * (users + in-app feedback). Separate project from the dashboard's internal
 * Supabase; configured via CONSUMER_SUPABASE_URL / CONSUMER_SERVICE_ROLE_KEY.
 */

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
  name: string | null;
  glp1_journey_stage: string | null;
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
    `users?select=id,email,name,glp1_journey_stage&email=ilike.${encodeURIComponent(cleaned)}&limit=2`,
  );
  return rows[0] ?? null;
}

export async function getUserById(id: string): Promise<ConsumerUserRow | null> {
  const rows = await cGet<ConsumerUserRow[]>(
    `users?select=id,email,name,glp1_journey_stage&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows[0] ?? null;
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
