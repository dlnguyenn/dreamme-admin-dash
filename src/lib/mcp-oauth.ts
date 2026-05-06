/**
 * Server-only OAuth 2.1 helpers for the self-hosted MCP image server.
 * Backs the /.well-known discovery + /api/oauth/* flows.
 *
 * Storage goes through Supabase REST with the service-role key — RLS
 * blocks anon access to the oauth tables so tokens/codes/clients are
 * not readable via the public REST API.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

export const ADMIN_PASSWORD =
  process.env.MCP_OAUTH_ADMIN_PASSWORD ?? "dreammeAdmin";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24; // 24h
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30d
export const AUTH_CODE_TTL_SECONDS = 60 * 5; // 5min

export function oauthConfigured(): boolean {
  return !!SUPABASE_URL && !!SERVICE_ROLE;
}

function headers() {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Base64Url(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}

export function safeStringEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ---------- Clients ----------

export interface OAuthClient {
  client_id: string;
  client_secret: string | null;
  client_name: string | null;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  grant_types: string[];
  scope: string | null;
}

export async function registerClient(params: {
  redirectUris: string[];
  clientName?: string;
  tokenEndpointAuthMethod?: string;
  grantTypes?: string[];
  scope?: string;
}): Promise<OAuthClient> {
  const clientId = `mcp_${randomToken(16)}`;
  // Public clients (PKCE only) leave secret null. We choose public unless
  // the registration explicitly asks for client_secret_basic.
  const isConfidential =
    params.tokenEndpointAuthMethod === "client_secret_basic" ||
    params.tokenEndpointAuthMethod === "client_secret_post";
  const clientSecret = isConfidential ? randomToken(32) : null;
  const row = {
    client_id: clientId,
    client_secret: clientSecret,
    client_name: params.clientName ?? null,
    redirect_uris: params.redirectUris,
    token_endpoint_auth_method:
      params.tokenEndpointAuthMethod ?? (isConfidential ? "client_secret_basic" : "none"),
    grant_types: params.grantTypes ?? ["authorization_code", "refresh_token"],
    scope: params.scope ?? null,
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/mcp_oauth_clients`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(
      `mcp_oauth_clients insert failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = await res.json();
  const r = Array.isArray(data) ? data[0] : data;
  return mapClient(r);
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/mcp_oauth_clients?client_id=eq.${encodeURIComponent(clientId)}&select=*`,
      { headers: headers(), cache: "no-store" },
    );
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return mapClient(arr[0]);
  } catch {
    return null;
  }
}

function mapClient(row: Record<string, unknown>): OAuthClient {
  return {
    client_id: row.client_id as string,
    client_secret: (row.client_secret as string | null) ?? null,
    client_name: (row.client_name as string | null) ?? null,
    redirect_uris: (row.redirect_uris as string[]) ?? [],
    token_endpoint_auth_method:
      (row.token_endpoint_auth_method as string) ?? "none",
    grant_types: (row.grant_types as string[]) ?? [
      "authorization_code",
      "refresh_token",
    ],
    scope: (row.scope as string | null) ?? null,
  };
}

// ---------- Authorization codes ----------

export interface OAuthCode {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string | null;
  expires_at: string;
  used: boolean;
}

export async function createAuthorizationCode(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string;
}): Promise<string> {
  const code = randomToken(32);
  const expiresAt = new Date(
    Date.now() + AUTH_CODE_TTL_SECONDS * 1000,
  ).toISOString();
  const row = {
    code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: params.codeChallengeMethod,
    scope: params.scope ?? null,
    expires_at: expiresAt,
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/mcp_oauth_codes`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(
      `mcp_oauth_codes insert failed: ${res.status} ${await res.text()}`,
    );
  }
  return code;
}

export async function consumeAuthorizationCode(
  code: string,
): Promise<OAuthCode | null> {
  // Atomically mark used=true if not used; PostgREST PATCH with filters.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/mcp_oauth_codes?code=eq.${encodeURIComponent(code)}&used=eq.false`,
    {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({ used: true }),
    },
  );
  if (!res.ok) return null;
  const arr = await res.json();
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const row = arr[0] as Record<string, unknown>;
  const out: OAuthCode = {
    code: row.code as string,
    client_id: row.client_id as string,
    redirect_uri: row.redirect_uri as string,
    code_challenge: row.code_challenge as string,
    code_challenge_method: row.code_challenge_method as string,
    scope: (row.scope as string | null) ?? null,
    expires_at: row.expires_at as string,
    used: row.used as boolean,
  };
  if (new Date(out.expires_at).getTime() < Date.now()) {
    return null;
  }
  return out;
}

// ---------- Access / refresh tokens ----------

export interface OAuthToken {
  access_token: string;
  refresh_token: string | null;
  client_id: string;
  scope: string | null;
  expires_at: string;
  refresh_expires_at: string | null;
  revoked: boolean;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string | null;
}

export async function issueTokens(params: {
  clientId: string;
  scope?: string | null;
}): Promise<IssuedTokens> {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const now = Date.now();
  const expiresAt = new Date(
    now + ACCESS_TOKEN_TTL_SECONDS * 1000,
  ).toISOString();
  const refreshExpiresAt = new Date(
    now + REFRESH_TOKEN_TTL_SECONDS * 1000,
  ).toISOString();
  const row = {
    access_token: accessToken,
    refresh_token: refreshToken,
    client_id: params.clientId,
    scope: params.scope ?? null,
    expires_at: expiresAt,
    refresh_expires_at: refreshExpiresAt,
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/mcp_oauth_tokens`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(
      `mcp_oauth_tokens insert failed: ${res.status} ${await res.text()}`,
    );
  }
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    scope: params.scope ?? null,
  };
}

export async function getTokenByAccess(
  accessToken: string,
): Promise<OAuthToken | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/mcp_oauth_tokens?access_token=eq.${encodeURIComponent(accessToken)}&select=*`,
      { headers: headers(), cache: "no-store" },
    );
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return mapToken(arr[0]);
  } catch {
    return null;
  }
}

export async function consumeRefreshToken(
  refreshToken: string,
): Promise<OAuthToken | null> {
  // Mark old token revoked so the refresh token can't be re-used (rotation).
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/mcp_oauth_tokens?refresh_token=eq.${encodeURIComponent(refreshToken)}&revoked=eq.false`,
    {
      method: "PATCH",
      headers: { ...headers(), Prefer: "return=representation" },
      body: JSON.stringify({ revoked: true }),
    },
  );
  if (!res.ok) return null;
  const arr = await res.json();
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const row = mapToken(arr[0]);
  if (
    row.refresh_expires_at &&
    new Date(row.refresh_expires_at).getTime() < Date.now()
  ) {
    return null;
  }
  return row;
}

function mapToken(row: Record<string, unknown>): OAuthToken {
  return {
    access_token: row.access_token as string,
    refresh_token: (row.refresh_token as string | null) ?? null,
    client_id: row.client_id as string,
    scope: (row.scope as string | null) ?? null,
    expires_at: row.expires_at as string,
    refresh_expires_at: (row.refresh_expires_at as string | null) ?? null,
    revoked: !!row.revoked,
  };
}

/**
 * Validate a bearer token presented to the MCP endpoint. Accepts either
 * the env-var bearer (so Claude Code stays simple) or a DB-backed OAuth
 * token. Returns true when the token is currently valid.
 */
export async function validateBearer(token: string): Promise<boolean> {
  const envToken = process.env.MCP_IMAGE_BEARER_TOKEN ?? "";
  if (envToken && safeStringEq(envToken, token)) return true;
  if (!oauthConfigured()) return false;
  const row = await getTokenByAccess(token);
  if (!row || row.revoked) return false;
  if (new Date(row.expires_at).getTime() < Date.now()) return false;
  return true;
}

/**
 * Verify a PKCE code_verifier against the stored code_challenge. Only S256
 * is supported per OAuth 2.1.
 */
export function verifyPkce(
  codeVerifier: string,
  codeChallenge: string,
  method: string,
): boolean {
  if (method !== "S256") return false;
  if (!codeVerifier || codeVerifier.length < 43 || codeVerifier.length > 128) {
    return false;
  }
  const computed = sha256Base64Url(codeVerifier);
  return safeStringEq(computed, codeChallenge);
}

export function originFromRequest(req: Request): string {
  const url = new URL(req.url);
  // Trust the proxy host header behind Vercel; req.url usually has it.
  return `${url.protocol}//${url.host}`;
}
