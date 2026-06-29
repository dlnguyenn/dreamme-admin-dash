/**
 * Server-only "Login with Facebook" helpers — obtain a long-lived Meta
 * Marketing API token via Facebook Login and store it per-connection in
 * Supabase (RLS-locked). The Ads MCP + syncs consume the stored token.
 *
 * Mirrors src/lib/mcp-oauth.ts: service-role Supabase REST, node:crypto.
 * Multi-tenant-ready (owner_id nullable); single shared connection for v1.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

function appId(): string {
  return process.env.META_OAUTH_APP_ID ?? "";
}
function clientSecret(): string {
  return process.env.META_OAUTH_CLIENT_SECRET ?? "";
}
function stateSecret(): string {
  // Fall back to the client secret so a missing var doesn't silently disable
  // CSRF protection; META_OAUTH_STATE_SECRET is preferred.
  return process.env.META_OAUTH_STATE_SECRET || clientSecret();
}
function apiVersion(): string {
  return process.env.META_API_VERSION ?? "v22.0";
}
export function defaultScopes(): string {
  return process.env.META_OAUTH_SCOPES ?? "ads_read,ads_management,business_management";
}

export function metaOAuthConfigured(): boolean {
  return !!appId() && !!clientSecret() && !!SUPABASE_URL && !!SERVICE_ROLE;
}

function svcHeaders() {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

// ---------- signed CSRF state (cookie) ----------
const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 min

export function createState(): string {
  const payload = `${randomBytes(16).toString("base64url")}.${Date.now()}`;
  const sig = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyState(state: string | undefined | null): boolean {
  if (!state) return false;
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [nonce, ts, sig] = parts;
  const expected = createHmac("sha256", stateSecret())
    .update(`${nonce}.${ts}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return false;
  return Date.now() - tsNum < STATE_MAX_AGE_MS;
}

// ---------- Facebook OAuth ----------
export function buildAuthUrl(params: {
  redirectUri: string;
  state: string;
  scopes?: string;
}): string {
  const qs = new URLSearchParams({
    client_id: appId(),
    redirect_uri: params.redirectUri,
    state: params.state,
    scope: params.scopes ?? defaultScopes(),
    response_type: "code",
  });
  return `https://www.facebook.com/${apiVersion()}/dialog/oauth?${qs.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; type?: string; code?: number };
}

async function graphGet<T>(path: string, query: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(query);
  const url = `https://graph.facebook.com/${apiVersion()}/${path}?${qs.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(
      `Meta OAuth ${path} failed: ${res.status} ${body?.error?.message ?? JSON.stringify(body)}`,
    );
  }
  return body as T;
}

/** Exchange the authorization code for a short-lived user token. */
export async function exchangeCodeForToken(params: {
  code: string;
  redirectUri: string;
}): Promise<string> {
  const body = await graphGet<TokenResponse>("oauth/access_token", {
    client_id: appId(),
    client_secret: clientSecret(),
    redirect_uri: params.redirectUri,
    code: params.code,
  });
  if (!body.access_token) throw new Error("No access_token in code-exchange response.");
  return body.access_token;
}

/** Exchange a short-lived token for a long-lived (~60d) one. */
export async function exchangeForLongLived(
  shortToken: string,
): Promise<{ token: string; expiresInSec: number | null }> {
  const body = await graphGet<TokenResponse>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId(),
    client_secret: clientSecret(),
    fb_exchange_token: shortToken,
  });
  if (!body.access_token) throw new Error("No access_token in long-lived exchange response.");
  return { token: body.access_token, expiresInSec: body.expires_in ?? null };
}

interface MeResponse {
  id: string;
  name?: string;
}
interface AdAccountsResponse {
  data?: Array<{ id: string; account_id?: string; name?: string }>;
}

export interface ConnectionIdentity {
  fbUserId: string;
  fbUserName: string;
  adAccounts: Array<{ id: string; name: string }>;
  defaultAdAccountId: string | null;
}

const PREFERRED_AD_ACCOUNT = "act_1575502753719515"; // DreamMe primary

export async function fetchIdentityAndAdAccounts(token: string): Promise<ConnectionIdentity> {
  const me = await graphGet<MeResponse>("me", { fields: "id,name", access_token: token });
  const accts = await graphGet<AdAccountsResponse>("me/adaccounts", {
    fields: "id,account_id,name",
    access_token: token,
    limit: "200",
  });
  const adAccounts = (accts.data ?? []).map((a) => ({
    id: a.id ?? (a.account_id ? `act_${a.account_id}` : ""),
    name: a.name ?? "",
  })).filter((a) => a.id);
  const defaultAdAccountId =
    adAccounts.find((a) => a.id === PREFERRED_AD_ACCOUNT)?.id ??
    adAccounts[0]?.id ??
    null;
  return {
    fbUserId: me.id,
    fbUserName: me.name ?? "",
    adAccounts,
    defaultAdAccountId,
  };
}

// ---------- connection storage ----------
export interface MetaConnection {
  id: string;
  fb_user_id: string | null;
  fb_user_name: string | null;
  access_token: string;
  token_expires_at: string | null;
  scopes: string | null;
  ad_accounts: Array<{ id: string; name: string }> | null;
  default_ad_account_id: string | null;
  status: string;
  updated_at: string;
}

/** Public (token-free) view for the Integrations panel. */
export interface MetaConnectionPublic {
  connected: boolean;
  fb_user_name?: string | null;
  token_expires_at?: string | null;
  scopes?: string | null;
  ad_accounts?: Array<{ id: string; name: string }> | null;
  default_ad_account_id?: string | null;
  status?: string;
  updated_at?: string;
}

export async function saveConnection(params: {
  token: string;
  expiresInSec: number | null;
  identity: ConnectionIdentity;
  scopes: string;
}): Promise<void> {
  const expiresAt = params.expiresInSec
    ? new Date(Date.now() + params.expiresInSec * 1000).toISOString()
    : null;

  // Demote any existing default connections first (single active connection).
  await fetch(
    `${SUPABASE_URL}/rest/v1/meta_connections?is_default=eq.true`,
    {
      method: "PATCH",
      headers: { ...svcHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify({ is_default: false, updated_at: new Date().toISOString() }),
    },
  );

  const row = {
    fb_user_id: params.identity.fbUserId,
    fb_user_name: params.identity.fbUserName,
    access_token: params.token,
    token_expires_at: expiresAt,
    scopes: params.scopes,
    ad_accounts: params.identity.adAccounts,
    default_ad_account_id: params.identity.defaultAdAccountId,
    status: "active",
    is_default: true,
    updated_at: new Date().toISOString(),
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/meta_connections`, {
    method: "POST",
    headers: { ...svcHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(`meta_connections insert failed: ${res.status} ${await res.text()}`);
  }
}

export async function getActiveConnection(): Promise<MetaConnection | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/meta_connections?status=eq.active&is_default=eq.true&select=*&order=updated_at.desc&limit=1`,
      { headers: svcHeaders(), cache: "no-store" },
    );
    if (!res.ok) return null;
    const arr = await res.json();
    return Array.isArray(arr) && arr.length ? (arr[0] as MetaConnection) : null;
  } catch {
    return null;
  }
}

export async function getConnectionPublic(): Promise<MetaConnectionPublic> {
  const c = await getActiveConnection();
  if (!c) return { connected: false };
  return {
    connected: true,
    fb_user_name: c.fb_user_name,
    token_expires_at: c.token_expires_at,
    scopes: c.scopes,
    ad_accounts: c.ad_accounts,
    default_ad_account_id: c.default_ad_account_id,
    status: c.status,
    updated_at: c.updated_at,
  };
}

export async function disconnectAll(): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/meta_connections?status=eq.active`, {
    method: "PATCH",
    headers: { ...svcHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify({ status: "revoked", is_default: false, updated_at: new Date().toISOString() }),
  });
}

/**
 * Re-extend long-lived tokens within `withinDays` of expiry by re-exchanging
 * the still-valid token (fb_exchange_token resets the ~60-day clock). Returns
 * how many were refreshed. Used by the refresh-meta-tokens cron.
 */
export async function refreshExpiring(withinDays = 7): Promise<{ refreshed: number; errors: string[] }> {
  const errors: string[] = [];
  let refreshed = 0;
  if (!SUPABASE_URL || !SERVICE_ROLE) return { refreshed, errors: ["supabase not configured"] };
  const cutoff = new Date(Date.now() + withinDays * 86_400_000).toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/meta_connections?status=eq.active&token_expires_at=lte.${cutoff}&select=*`,
    { headers: svcHeaders(), cache: "no-store" },
  );
  if (!res.ok) return { refreshed, errors: [`read failed: ${res.status}`] };
  const rows = (await res.json()) as MetaConnection[];
  for (const c of rows) {
    try {
      const { token, expiresInSec } = await exchangeForLongLived(c.access_token);
      const expiresAt = expiresInSec
        ? new Date(Date.now() + expiresInSec * 1000).toISOString()
        : null;
      const up = await fetch(`${SUPABASE_URL}/rest/v1/meta_connections?id=eq.${c.id}`, {
        method: "PATCH",
        headers: { ...svcHeaders(), Prefer: "return=minimal" },
        body: JSON.stringify({ access_token: token, token_expires_at: expiresAt, updated_at: new Date().toISOString() }),
      });
      if (!up.ok) {
        errors.push(`update ${c.id}: ${up.status}`);
      } else {
        refreshed++;
      }
    } catch (e) {
      errors.push(`${c.id}: ${e instanceof Error ? e.message : String(e)}`);
      // Mark error so the panel surfaces it.
      await fetch(`${SUPABASE_URL}/rest/v1/meta_connections?id=eq.${c.id}`, {
        method: "PATCH",
        headers: { ...svcHeaders(), Prefer: "return=minimal" },
        body: JSON.stringify({ status: "error", updated_at: new Date().toISOString() }),
      });
    }
  }
  return { refreshed, errors };
}
