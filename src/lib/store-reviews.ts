/**
 * App Store + Google Play reviews for DreamMe — the Store Reviews tab.
 *
 * Both stores are read with their own server APIs and upserted into
 * `store_reviews` (migration 0089). Stored because the Google Play reviews
 * API only returns reviews created or edited in the last 7 days; App Store
 * Connect returns the full history every time.
 *
 * Which reviews need attention is pure (`attentionFor`) and pinned by
 * tests/store-reviews.test.ts:
 *   - a store reply, or "Mark handled" in the tab, clears a review, unless
 *     the reviewer edited it afterwards. Both stores move the review's date
 *     on an edit (Apple's createdDate too), so reviewed_at > replied_at
 *     means the reviewer came back after our reply.
 *   - billing words (refund, charged, scam, pay...) on a 1-3 star review
 *   - broken-app words (crash, lost my data, can't log in...) at any rating
 *   - any other 1-3 star review
 *   An edit after our reply only counts when one of the last three holds.
 *
 * Env:
 *   ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY (the .p8 contents; ASC_P8 = a
 *     path to the .p8 also works for local dev, as in app-store-localization/asc.js)
 *   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (the key file contents; GOOGLE_PLAY_KEY_FILE
 *     = a path also works locally). The service account needs Play Console
 *     access to reviews; play-publisher@forum-496322 has it.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { ASC_APP_ID, PLAY_PACKAGE, attentionFor, type Store, type StoreReviewRow, type SyncResult } from "./store-reviews-shared";

export * from "./store-reviews-shared";

// ── App Store Connect ──────────────────────────────────────────────────

const b64url = (b: string | Buffer) => Buffer.from(b).toString("base64url");
const pemFromEnv = (v: string) => v.replace(/\\n/g, "\n");

function ascKey(): string | null {
  if (process.env.ASC_PRIVATE_KEY) return pemFromEnv(process.env.ASC_PRIVATE_KEY);
  if (process.env.ASC_P8) return fs.readFileSync(process.env.ASC_P8, "utf8");
  return null;
}

export function appStoreConfigured(): boolean {
  return !!process.env.ASC_KEY_ID && !!process.env.ASC_ISSUER_ID && !!(process.env.ASC_PRIVATE_KEY || process.env.ASC_P8);
}

function ascToken(): string {
  const key = ascKey();
  if (!key) throw new Error("ASC_PRIVATE_KEY not set");
  const header = b64url(JSON.stringify({ alg: "ES256", kid: process.env.ASC_KEY_ID, typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" }));
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${b64url(sig)}`;
}

interface AscReview {
  id: string;
  attributes: { rating: number; title?: string; body?: string; reviewerNickname?: string; createdDate: string; territory?: string };
  relationships?: { response?: { data: { id: string } | null } };
}
interface AscResponse {
  id: string;
  attributes: { responseBody?: string; lastModifiedDate?: string; state?: string };
}

export async function fetchAppStoreReviews(): Promise<StoreReviewRow[]> {
  const token = ascToken();
  const out: StoreReviewRow[] = [];
  let url: string | null =
    `https://api.appstoreconnect.apple.com/v1/apps/${ASC_APP_ID}/customerReviews?limit=200&sort=-createdDate&include=response`;
  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) throw new Error(`App Store Connect ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { data: AscReview[]; included?: AscResponse[]; links?: { next?: string } };
    const responses = new Map((j.included ?? []).map((x) => [x.id, x.attributes]));
    for (const d of j.data) {
      const a = d.attributes;
      const respId = d.relationships?.response?.data?.id;
      const resp = respId ? responses.get(respId) : undefined;
      out.push({
        id: `app_store:${d.id}`,
        store: "app_store",
        review_id: d.id,
        rating: a.rating,
        title: a.title ?? null,
        body: a.body ?? "",
        reviewer: a.reviewerNickname ?? null,
        territory: a.territory ?? null,
        language: null,
        app_version: null,
        device: null,
        reviewed_at: new Date(a.createdDate).toISOString(),
        reply_body: resp?.responseBody ?? null,
        replied_at: resp?.lastModifiedDate ? new Date(resp.lastModifiedDate).toISOString() : null,
        reply_state: resp?.state ?? null,
      });
    }
    url = j.links?.next ?? null;
  }
  return out;
}

// ── Google Play ────────────────────────────────────────────────────────

function playKey(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
    ?? (process.env.GOOGLE_PLAY_KEY_FILE ? fs.readFileSync(process.env.GOOGLE_PLAY_KEY_FILE, "utf8") : null);
  if (!raw) return null;
  const k = JSON.parse(raw) as { client_email: string; private_key: string };
  return { client_email: k.client_email, private_key: pemFromEnv(k.private_key) };
}

export function playConfigured(): boolean {
  return !!(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_PLAY_KEY_FILE);
}

async function playToken(): Promise<string> {
  const k = playKey();
  if (!k) throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON not set");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: k.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), k.private_key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${header}.${payload}.${b64url(sig)}`,
    cache: "no-store",
  });
  const j = (await res.json()) as { access_token?: string; error_description?: string };
  if (!j.access_token) throw new Error(`Google OAuth: ${j.error_description ?? res.status}`);
  return j.access_token;
}

interface PlayTime { seconds: string; nanos?: number }
interface PlayReview {
  reviewId: string;
  authorName?: string;
  comments: {
    userComment?: {
      text: string;
      lastModified: PlayTime;
      starRating: number;
      reviewerLanguage?: string;
      appVersionName?: string;
      device?: string;
      deviceMetadata?: { productName?: string };
    };
    developerComment?: { text: string; lastModified: PlayTime };
  }[];
}

const playTime = (t: PlayTime) => new Date(Number(t.seconds) * 1000).toISOString();

export function playRow(rv: PlayReview): StoreReviewRow | null {
  const u = rv.comments.find((c) => c.userComment)?.userComment;
  if (!u) return null;
  const dev = rv.comments.find((c) => c.developerComment)?.developerComment;
  // Play sends "title\tbody" when the reviewer wrote a title.
  const tab = u.text.indexOf("\t");
  return {
    id: `google_play:${rv.reviewId}`,
    store: "google_play",
    review_id: rv.reviewId,
    rating: u.starRating,
    title: tab > 0 ? u.text.slice(0, tab).trim() : null,
    body: (tab > 0 ? u.text.slice(tab + 1) : u.text).trim(),
    reviewer: rv.authorName ?? null,
    territory: null,
    language: u.reviewerLanguage ?? null,
    app_version: u.appVersionName ?? null,
    device: u.deviceMetadata?.productName ?? u.device ?? null,
    reviewed_at: playTime(u.lastModified),
    reply_body: dev?.text ?? null,
    replied_at: dev ? playTime(dev.lastModified) : null,
    reply_state: null,
  };
}

const PLAY_API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PLAY_PACKAGE}/reviews`;

/**
 * Lists the last 7 days, then re-reads `recheckIds` (stored reviews still
 * open) one by one so a reply posted in Play Console clears them even after
 * they fall out of the list window. A failed re-read is skipped.
 */
export async function fetchPlayReviews(recheckIds: string[] = []): Promise<StoreReviewRow[]> {
  const token = await playToken();
  const headers = { Authorization: `Bearer ${token}` };
  const out = new Map<string, StoreReviewRow>();
  let pageToken: string | undefined;
  do {
    const res: Response = await fetch(`${PLAY_API}?maxResults=100${pageToken ? `&token=${encodeURIComponent(pageToken)}` : ""}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Google Play ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { reviews?: PlayReview[]; tokenPagination?: { nextPageToken?: string } };
    for (const rv of j.reviews ?? []) {
      const row = playRow(rv);
      if (row) out.set(row.review_id, row);
    }
    pageToken = j.tokenPagination?.nextPageToken;
  } while (pageToken);

  for (const id of recheckIds.filter((x) => !out.has(x)).slice(0, 50)) {
    try {
      const res = await fetch(`${PLAY_API}/${encodeURIComponent(id)}`, { headers, cache: "no-store" });
      if (!res.ok) continue;
      const row = playRow((await res.json()) as PlayReview);
      if (row) out.set(row.review_id, row);
    } catch {
      // keep the stored copy
    }
  }
  return [...out.values()];
}

// ── Storage ────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";
const sbHeaders = () => ({ apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" });

export function storeReviewsDbConfigured(): boolean {
  return !!SUPABASE_URL && !!SERVICE_ROLE;
}

export async function listStoredReviews(): Promise<StoreReviewRow[]> {
  const out: StoreReviewRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/store_reviews?select=*&order=reviewed_at.desc&limit=1000&offset=${offset}`, {
      headers: sbHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Supabase ${res.status} (store_reviews): ${(await res.text()).slice(0, 200)}`);
    const page = (await res.json()) as StoreReviewRow[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

/** Writes only the store's fields, so first_seen_at and handled_at are kept. */
async function upsertReviews(rows: StoreReviewRow[]): Promise<void> {
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({
      id: r.id, store: r.store, review_id: r.review_id, rating: r.rating, title: r.title, body: r.body,
      reviewer: r.reviewer, territory: r.territory, language: r.language, app_version: r.app_version,
      device: r.device, reviewed_at: r.reviewed_at, reply_body: r.reply_body, replied_at: r.replied_at,
      reply_state: r.reply_state, last_synced_at: now,
    }));
    const res = await fetch(`${SUPABASE_URL}/rest/v1/store_reviews?on_conflict=id`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`Supabase upsert ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export async function setHandled(id: string, handled: boolean): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/store_reviews?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...sbHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ handled_at: handled ? new Date().toISOString() : null }),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Syncs both stores; one store failing never blocks the other. */
export async function syncStoreReviews(): Promise<SyncResult[]> {
  const stored = await listStoredReviews();
  const openPlay = stored
    .filter((r) => r.store === "google_play" && attentionFor(r).needsAttention)
    .map((r) => r.review_id);
  const jobs: [Store, boolean, () => Promise<StoreReviewRow[]>][] = [
    ["app_store", appStoreConfigured(), fetchAppStoreReviews],
    ["google_play", playConfigured(), () => fetchPlayReviews(openPlay)],
  ];
  return Promise.all(
    jobs.map(async ([store, configured, fetcher]): Promise<SyncResult> => {
      if (!configured) return { store, ok: false, fetched: 0, error: "credentials not set" };
      try {
        const rows = await fetcher();
        await upsertReviews(rows);
        return { store, ok: true, fetched: rows.length };
      } catch (e) {
        return { store, ok: false, fetched: 0, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}
