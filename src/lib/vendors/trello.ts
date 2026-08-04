/**
 * Trello REST API v1 client (bare fetch, no SDK) for filing Support Inbox
 * threads as cards on Dan's personal board (dlnguyenn@gmail.com).
 *
 * Auth note: Trello's docs show key+token as query params. We send them as a
 * header instead — `Authorization: OAuth oauth_consumer_key="…",
 * oauth_token="…"` — so the credentials never appear in a request URL, a
 * Vercel access log, or an error message we echo back to the UI.
 *
 * The "also file it as a feature request" half of the support action does
 * NOT live here — it writes a row to the dash's own feature_requests table
 * (the Feature Requests tab), not a second Trello list.
 *
 * Get the two secrets at https://trello.com/power-ups/admin (API key) then
 * https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&key=…
 * List ids come from `npm run trello:lists`.
 */

const BASE = "https://api.trello.com/1";
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

// Read env lazily inside functions — top-level constants capture process.env
// before loadEnvConfig runs in CLI scripts (ESM imports hoist).
function getKey(): string {
  return process.env.TRELLO_API_KEY ?? "";
}
function getToken(): string {
  return process.env.TRELLO_TOKEN ?? "";
}
export function getListId(): string {
  return process.env.TRELLO_LIST_ID ?? "";
}

/** Credentials AND a destination list — a card needs somewhere to land. */
export function trelloConfigured(): boolean {
  return !!getKey() && !!getToken() && !!getListId();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function trelloFetch<T>(
  path: string,
  opts?: { method?: "GET" | "POST" | "PUT" | "DELETE"; form?: Record<string, string> },
  maxRetries = 3,
): Promise<T> {
  const key = getKey();
  const token = getToken();
  if (!key || !token) throw new Error("TRELLO_API_KEY / TRELLO_TOKEN not set");
  const method = opts?.method ?? "GET";
  const body = opts?.form ? new URLSearchParams(opts.form).toString() : undefined;
  let attempt = 0;
  while (true) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `OAuth oauth_consumer_key="${key}", oauth_token="${token}"`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body,
      cache: "no-store",
    });
    if (res.ok) return (await res.json()) as T;
    const text = await res.text();
    // Trello rate-limits hard (100 req/10s per token) and answers 429 with a
    // plain-text body, so retry GETs only — a retried POST would duplicate a
    // card, which is exactly the failure this feature must not have.
    if (!RETRYABLE.has(res.status) || attempt >= maxRetries || method !== "GET") {
      throw new Error(`Trello ${res.status}: ${text.slice(0, 300)}`);
    }
    await sleep(Math.min(8000, 500 * Math.pow(2, attempt)));
    attempt++;
  }
}

// ---------------------------------------------------------------------------

export interface TrelloCard {
  id: string;
  name: string;
  /** short permalink, e.g. https://trello.com/c/abc12345 */
  shortUrl: string;
  url: string;
  idList: string;
}

export interface TrelloList {
  id: string;
  name: string;
  closed: boolean;
}

export interface TrelloBoard {
  id: string;
  name: string;
  url: string;
  closed: boolean;
}

export async function createCard(params: {
  idList: string;
  name: string;
  desc: string;
}): Promise<TrelloCard> {
  return trelloFetch<TrelloCard>("/cards", {
    method: "POST",
    form: {
      idList: params.idList,
      name: params.name,
      desc: params.desc,
      pos: "top",
    },
  });
}

/** Open boards on the token's account, for the discovery script. */
export async function listBoards(): Promise<TrelloBoard[]> {
  return trelloFetch<TrelloBoard[]>(
    "/members/me/boards?fields=name,url,closed&filter=open",
  );
}

export async function listLists(boardId: string): Promise<TrelloList[]> {
  return trelloFetch<TrelloList[]>(
    `/boards/${encodeURIComponent(boardId)}/lists?fields=name,closed&filter=open`,
  );
}
