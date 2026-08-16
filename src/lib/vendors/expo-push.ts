/**
 * Expo Push API client (bare fetch, no SDK).
 *
 * Sends SILENT pushes (content-available, no title/body/sound) that wake the
 * DreamMe app so it fires trial-quality events (trial_qualified /
 * trial_engaged) to the Meta SDK and Singular on-device. Replaces the dead
 * n8n workflow wEZAcV8qNd0OTUBQ — see docs/trial-pings.md.
 *
 * No auth token: Expo's push API is keyed by the recipient ExponentPushToken
 * itself (project-scoped). Mirrors the tiktok-ads.ts retry/backoff pattern.
 *
 * PAYLOAD CONTRACT (do not drift — the app type-checks it):
 * utils/notificationHandler.ts in davngu28/DreamMe requires
 *   data.type                    'trial_qualified' | 'trial_engaged'
 *   data.originalTransactionId   string
 *   data.productId               string
 *   data.priceUsd                NUMBER (a string is rejected client-side)
 * and `_contentAvailable: true` so iOS delivers it as a background wake with
 * no visible notification.
 */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo accepts at most 100 messages per request.
const CHUNK = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type TrialPingType = "trial_qualified" | "trial_engaged";

export interface TrialPingTarget {
  expoPushToken: string;
  pingType: TrialPingType;
  originalTransactionId: string;
  productId: string;
  priceUsd: number;
}

export interface ExpoPushMessage {
  to: string;
  _contentAvailable: true;
  priority: "high";
  data: {
    type: TrialPingType;
    originalTransactionId: string;
    productId: string;
    priceUsd: number;
  };
}

export interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Pure builder, exported for tests. Guarantees the payload contract. */
export function buildTrialPingMessages(
  targets: TrialPingTarget[],
): ExpoPushMessage[] {
  return targets.map((t) => ({
    to: t.expoPushToken,
    _contentAvailable: true,
    priority: "high",
    data: {
      type: t.pingType,
      originalTransactionId: t.originalTransactionId,
      productId: t.productId,
      // Coerce defensively: rc_events.price_usd arrives as a numeric string
      // through PostgREST, and the app REJECTS non-number priceUsd.
      priceUsd: Number(t.priceUsd),
    },
  }));
}

async function postChunk(
  messages: ExpoPushMessage[],
  maxRetries: number,
): Promise<ExpoTicket[]> {
  let attempt = 0;
  while (true) {
    const res = await fetch(PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(messages),
      cache: "no-store",
    });
    if (res.ok) {
      const body = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = body.data ?? [];
      if (tickets.length !== messages.length) {
        // Expo guarantees positional correspondence; a mismatch means we
        // cannot attribute tickets to messages — fail loudly, ledger rows
        // stay claimed-with-null-status rather than mislabeled.
        throw new Error(
          `Expo returned ${tickets.length} tickets for ${messages.length} messages`,
        );
      }
      return tickets;
    }
    const text = await res.text();
    if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
      throw new Error(`Expo push error: ${res.status} ${text.slice(0, 200)}`);
    }
    const retryAfter = res.headers.get("retry-after");
    const retryMs = retryAfter
      ? Math.max(0, Math.min(60_000, Number(retryAfter) * 1000))
      : 0;
    const backoff = Math.min(32_000, 1000 * Math.pow(2, attempt));
    await sleep(retryMs || backoff + Math.floor(Math.random() * 250));
    attempt++;
  }
}

/**
 * Send silent trial pings. Returns tickets aligned 1:1 with `targets` order.
 * Chunked to Expo's 100-message limit; a failed chunk throws (route 502s and
 * the GH Actions run goes red — claimed ledger rows keep null status, visible
 * for follow-up rather than silently dropped).
 */
export async function sendTrialPings(
  targets: TrialPingTarget[],
  maxRetries = 4,
): Promise<ExpoTicket[]> {
  const messages = buildTrialPingMessages(targets);
  const out: ExpoTicket[] = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    out.push(...(await postChunk(messages.slice(i, i + CHUNK), maxRetries)));
  }
  return out;
}
