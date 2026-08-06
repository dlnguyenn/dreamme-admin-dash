/**
 * Gmail API v1 client (bare fetch, no SDK) for Support Inbox ingestion.
 *
 * Replaces the IMAP transport. Two reasons beyond speed: the App Password
 * (DREAMME_SMTP_PASS) that IMAP relies on is basic auth Google keeps
 * tightening, and IMAP's (UIDVALIDITY, UID) cursor silently resets and
 * re-reads the mailbox. Gmail's historyId is a real incremental cursor.
 *
 * Messages are fetched with format=raw so the same mailparser path serves
 * both transports — see support/rfc822.ts. Anything else would risk the two
 * transports keying threads differently.
 *
 * historyId caveat: Gmail keeps roughly a week of history. A cursor older
 * than that returns 404, which is NOT an error — it means "fall back to a
 * list query". listRecentMessageIds() is that fallback, and the scheduled
 * poll stays in place as a backstop for exactly this reason.
 *
 * Auth: OAuth refresh token for dan@dreamme.life. Scope is gmail.readonly —
 * enough to read and to register a watch. Writing labels back to Gmail would
 * need gmail.modify and one re-consent.
 *
 * Setup: `npm run gmail-auth` mints GMAIL_REFRESH_TOKEN.
 */

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

// Read env lazily inside functions — top-level constants capture process.env
// before loadEnvConfig runs in CLI scripts (ESM imports hoist).
function clientId(): string {
  return process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
}
function clientSecret(): string {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";
}
function refreshToken(): string {
  return process.env.GMAIL_REFRESH_TOKEN ?? "";
}

/**
 * Gmail label to ingest from. Set this to a label applied by a Gmail filter
 * on help@/feedback@ mail and ingestion only ever sees real support mail,
 * instead of the whole 1,500-message inbox filtered after the fact.
 */
export function supportLabel(): string {
  return process.env.SUPPORT_GMAIL_LABEL ?? "";
}

export function gmailConfigured(): boolean {
  return !!clientId() && !!clientSecret() && !!refreshToken();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Access tokens last an hour; cache so a poll doesn't mint one per call. */
let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  if (!gmailConfigured()) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GMAIL_REFRESH_TOKEN not set",
    );
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken(),
      grant_type: "refresh_token",
    }).toString(),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  } | null;
  if (!res.ok || !body?.access_token) {
    throw new Error(
      `Gmail token ${res.status}: ${body?.error_description ?? body?.error ?? "refresh failed"}`,
    );
  }
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

/** Thrown when a historyId is too old to expand — callers fall back to a list. */
export class HistoryExpiredError extends Error {
  constructor() {
    super("Gmail historyId expired — full list required");
    this.name = "HistoryExpiredError";
  }
}

/**
 * A message id from the history no longer resolves — deleted or trashed
 * between the history record being written and us reading it. Permanent, so
 * callers must skip it rather than retry: a message that will never be
 * fetchable would otherwise wedge the cursor forever.
 */
export class MessageGoneError extends Error {
  constructor(id: string) {
    super(`Gmail message ${id} no longer exists`);
    this.name = "MessageGoneError";
  }
}

async function gmailFetch<T>(
  path: string,
  opts?: { method?: "GET" | "POST"; body?: unknown },
  maxRetries = 3,
): Promise<T> {
  const method = opts?.method ?? "GET";
  let attempt = 0;
  while (true) {
    const token = await getAccessToken();
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opts?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
    if (res.ok) return (await res.json()) as T;
    const text = await res.text();
    // A 404 on the history endpoint means the cursor aged out, not a bug.
    if (res.status === 404 && path.startsWith("/history")) {
      throw new HistoryExpiredError();
    }
    if (res.status === 401) {
      cachedToken = null; // token revoked or clock skew — mint a fresh one once
      if (attempt < 1) {
        attempt++;
        continue;
      }
    }
    if (!RETRYABLE.has(res.status) || attempt >= maxRetries) {
      let message = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        if (parsed.error?.message) message = parsed.error.message;
      } catch {}
      throw new Error(`Gmail ${res.status}: ${message}`);
    }
    await sleep(Math.min(8000, 500 * Math.pow(2, attempt)));
    attempt++;
  }
}

// ---------------------------------------------------------------------------

export interface GmailProfile {
  emailAddress: string;
  historyId: string;
}

export async function getProfile(): Promise<GmailProfile> {
  return gmailFetch<GmailProfile>("/profile");
}

export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
}

export async function listLabels(): Promise<GmailLabel[]> {
  const res = await gmailFetch<{ labels?: GmailLabel[] }>("/labels");
  return res.labels ?? [];
}

/** Resolve a human label name ("Users/Support") to its Gmail label id. */
export async function labelIdByName(name: string): Promise<string | null> {
  if (!name) return null;
  const wanted = name.trim().toLowerCase();
  const match = (await listLabels()).find((l) => l.name.toLowerCase() === wanted);
  return match?.id ?? null;
}

/**
 * Newest-first message ids, used on a cold start or when the history cursor
 * has aged out. `q` accepts Gmail search syntax ("newer_than:7d").
 */
export async function listRecentMessageIds(params: {
  labelIds?: string[];
  q?: string;
  max?: number;
}): Promise<string[]> {
  const qs = new URLSearchParams({ maxResults: String(params.max ?? 50) });
  for (const id of params.labelIds ?? []) qs.append("labelIds", id);
  if (params.q) qs.set("q", params.q);
  const res = await gmailFetch<{ messages?: Array<{ id: string }> }>(
    `/messages?${qs.toString()}`,
  );
  return (res.messages ?? []).map((m) => m.id);
}

/**
 * Message ids added since `startHistoryId`, plus the new cursor.
 * Throws HistoryExpiredError when the cursor is older than Gmail's retention.
 */
export async function listAddedSince(
  startHistoryId: string,
  labelId?: string | null,
): Promise<{ ids: string[]; historyId: string }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let latest = startHistoryId;
  do {
    const qs = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
      maxResults: "500",
    });
    if (labelId) qs.set("labelId", labelId);
    if (pageToken) qs.set("pageToken", pageToken);
    const res = await gmailFetch<{
      history?: Array<{ messagesAdded?: Array<{ message: { id: string } }> }>;
      historyId?: string;
      nextPageToken?: string;
    }>(`/history?${qs.toString()}`);
    for (const h of res.history ?? []) {
      for (const m of h.messagesAdded ?? []) ids.push(m.message.id);
    }
    if (res.historyId) latest = res.historyId;
    pageToken = res.nextPageToken;
  } while (pageToken);
  return { ids: [...new Set(ids)], historyId: latest };
}

export interface GmailRawMessage {
  /** RFC822 bytes, so support/rfc822.ts parses it exactly like IMAP source */
  raw: Buffer;
  /** SENT / INBOX / user label ids — history.list cannot be trusted to filter */
  labelIds: string[];
}

export async function getMessage(id: string): Promise<GmailRawMessage> {
  let res: { raw?: string; labelIds?: string[] };
  try {
    res = await gmailFetch<{ raw?: string; labelIds?: string[] }>(
      `/messages/${encodeURIComponent(id)}?format=raw`,
    );
  } catch (e) {
    // A 404 here is a message that was deleted after its history record was
    // written. Distinguish it so the caller can skip rather than retry.
    if (e instanceof Error && /^Gmail 404:/.test(e.message)) {
      throw new MessageGoneError(id);
    }
    throw e;
  }
  if (!res.raw) throw new Error(`Gmail message ${id} returned no raw body`);
  return { raw: Buffer.from(res.raw, "base64url"), labelIds: res.labelIds ?? [] };
}

// ---------------------------------------------------------------------------
// Phase 2 — Pub/Sub push. Registering a watch is harmless without a
// subscriber, so these ship now and stay unused until the topic exists.

export interface WatchResponse {
  historyId: string;
  /** ms epoch as a string; Gmail expires a watch after ~7 days */
  expiration: string;
}

export async function watchMailbox(params: {
  topicName: string; // projects/<project>/topics/<topic>
  labelIds?: string[];
}): Promise<WatchResponse> {
  return gmailFetch<WatchResponse>("/watch", {
    method: "POST",
    body: {
      topicName: params.topicName,
      labelFilterBehavior: "include",
      ...(params.labelIds?.length ? { labelIds: params.labelIds } : {}),
    },
  });
}

export async function stopWatch(): Promise<void> {
  await gmailFetch<unknown>("/stop", { method: "POST" });
}
