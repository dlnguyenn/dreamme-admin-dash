/**
 * Who holds a subscription right now, for the audience sync (audiences.ts).
 *
 * Source: the consumer app's `subscriptions` table, one current-state row per
 * subscription kept live by the app's own RevenueCat webhook, with the account
 * email one lookup away in `users`. A handful of reads covers every subscriber.
 *
 * It replaces a walk of RevenueCat's customer list, which cannot do this job.
 * Measured 2026-11-05: the list comes back in no useful order, 100 customers a
 * page at ~0.3s, with one more request per customer to learn whether they
 * subscribe. 14,500 customers took 45s to list and the list was not finished,
 * against a 300s function limit. This table held 5,019 live rows the same day
 * RevenueCat reported 5,025 active subscriptions and trials.
 *
 * Env is read lazily: CLI scripts import this before loadEnvConfig has run.
 */
import { PAGE_SIZE, countFromContentRange, fetchAllPages } from "@/lib/pagedFetch";

const RELAY_DOMAIN = "@privaterelay.appleid.com";
const EMAIL_LOOKUP_CHUNK = 100; // ids per users request; keeps the URL short
const EMAIL_LOOKUP_CONCURRENCY = 8;
const MAX_SUBSCRIPTION_PAGES = 50;

function consumerUrl(): string {
  return process.env.CONSUMER_SUPABASE_URL ?? "";
}
function consumerKey(): string {
  return process.env.CONSUMER_SERVICE_ROLE_KEY ?? "";
}

export function audienceSourceConfigured(): boolean {
  return Boolean(consumerUrl() && consumerKey());
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const key = consumerKey();
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

async function consumerGet<T>(path: string): Promise<T> {
  const res = await fetch(`${consumerUrl()}/rest/v1/${path}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Consumer Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

interface SubscriptionRow {
  /** Consumer account id, equal to the RevenueCat app_user_id. Null for a purchase made before sign-up. */
  user_id: string | null;
  product_id: string | null;
  purchased_at: string | null;
  original_purchased_at: string | null;
  expires_at: string;
}

export interface ActiveSubscriber {
  customerId: string; // RevenueCat app_user_id
  email: string; // lowercase, never an Apple relay address
  productId: string | null;
  startsAtMs: number | null; // first purchase, for tenure
  expiresAtMs: number | null;
}

export interface ActiveSubscriberScan {
  /**
   * Every live subscription holder, matchable in Meta or not. This is the
   * figure to hold against RevenueCat's own active count.
   */
  totalActive: number;
  /** The subset with an email Meta can match. */
  subscribers: ActiveSubscriber[];
  skipped: { noAccount: number; noEmail: number; relay: number };
}

interface Holding {
  productId: string | null;
  startsAtMs: number | null;
  expiresAtMs: number;
}

/**
 * One holding per account: the earliest first purchase (longest tenure) and
 * the latest expiry, since an account can carry more than one live row after a
 * plan change. Rows without an account are counted, not returned.
 */
export function collapseSubscriptions(rows: SubscriptionRow[]): {
  byAccount: Map<string, Holding>;
  noAccount: number;
} {
  const byAccount = new Map<string, Holding>();
  let noAccount = 0;
  for (const row of rows) {
    if (!row.user_id) {
      noAccount++;
      continue;
    }
    const started = Date.parse(row.original_purchased_at ?? row.purchased_at ?? "");
    const startsAtMs = Number.isFinite(started) ? started : null;
    const expiresAtMs = Date.parse(row.expires_at);
    const held = byAccount.get(row.user_id);
    if (!held) {
      byAccount.set(row.user_id, { productId: row.product_id, startsAtMs, expiresAtMs });
      continue;
    }
    if (startsAtMs !== null && (held.startsAtMs === null || startsAtMs < held.startsAtMs)) {
      held.startsAtMs = startsAtMs;
    }
    if (expiresAtMs > held.expiresAtMs) {
      held.expiresAtMs = expiresAtMs;
      held.productId = row.product_id;
    }
  }
  return { byAccount, noAccount };
}

async function fetchLiveSubscriptions(nowIso: string): Promise<SubscriptionRow[]> {
  const filter =
    `environment=eq.production&is_active=is.true` +
    `&expires_at=gt.${encodeURIComponent(nowIso)}`;
  return fetchAllPages<SubscriptionRow>({
    maxPages: MAX_SUBSCRIPTION_PAGES,
    count: async () => {
      const res = await fetch(`${consumerUrl()}/rest/v1/subscriptions?select=id&${filter}`, {
        method: "HEAD",
        headers: headers({ Prefer: "count=exact", Range: "0-0" }),
        cache: "no-store",
      });
      return res.ok ? countFromContentRange(res.headers.get("content-range")) : null;
    },
    page: (offset) =>
      consumerGet<SubscriptionRow[]>(
        `subscriptions?select=user_id,product_id,purchased_at,original_purchased_at,expires_at` +
          `&${filter}&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`,
      ),
  });
}

async function fetchEmails(ids: string[]): Promise<Map<string, string | null>> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += EMAIL_LOOKUP_CHUNK) {
    chunks.push(ids.slice(i, i + EMAIL_LOOKUP_CHUNK));
  }
  const out = new Map<string, string | null>();
  let cursor = 0;
  const runners = Array.from({ length: EMAIL_LOOKUP_CONCURRENCY }, async () => {
    while (cursor < chunks.length) {
      const chunk = chunks[cursor++];
      const rows = await consumerGet<{ id: string; email: string | null }[]>(
        `users?select=id,email&id=in.(${chunk.map((id) => encodeURIComponent(id)).join(",")})`,
      );
      for (const r of rows) out.set(r.id, r.email);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Every account with a live production subscription, with the email Meta can
 * match where there is one. Apple relay addresses and accounts without an
 * email are counted in `skipped`, never returned.
 */
export async function fetchActiveSubscribers(opts: {
  nowMs?: number;
  log?: (msg: string) => void;
} = {}): Promise<ActiveSubscriberScan> {
  if (!audienceSourceConfigured()) throw new Error("Consumer Supabase env missing");
  const log = opts.log ?? (() => {});
  const nowIso = new Date(opts.nowMs ?? Date.now()).toISOString();

  const rows = await fetchLiveSubscriptions(nowIso);
  const { byAccount, noAccount } = collapseSubscriptions(rows);
  log(`  ${rows.length} live subscriptions across ${byAccount.size} accounts.`);

  const emails = await fetchEmails([...byAccount.keys()]);
  const subscribers: ActiveSubscriber[] = [];
  let noEmail = 0;
  let relay = 0;
  for (const [customerId, held] of byAccount) {
    const email = (emails.get(customerId) ?? "").trim().toLowerCase();
    if (!email) {
      noEmail++;
      continue;
    }
    if (email.endsWith(RELAY_DOMAIN)) {
      relay++;
      continue;
    }
    subscribers.push({ customerId, email, ...held });
  }
  log(
    `  ${subscribers.length} with a usable email (skipped ${relay} relay, ${noEmail} no-email, ${noAccount} without an account).`,
  );
  return {
    totalActive: byAccount.size + noAccount,
    subscribers,
    skipped: { noAccount, noEmail, relay },
  };
}
