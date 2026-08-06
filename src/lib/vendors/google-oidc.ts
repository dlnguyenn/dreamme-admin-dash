/**
 * Verify a Google-signed OIDC identity token (bare fetch + WebCrypto, no SDK).
 *
 * Used by the Gmail Pub/Sub push endpoint: the subscription is configured
 * with "authenticated push", so Google mints an RS256 JWT per delivery,
 * signed by Google's own keys, with `aud` set to our endpoint URL and
 * `email` set to the invoker service account. Verifying those three things
 * (signature, audience, caller identity) is what makes the endpoint safe to
 * expose without a shared secret — there is nothing to leak or rotate.
 *
 * JWKS is fetched from Google's published endpoint and cached in-module for
 * an hour; a key-id miss busts the cache once (key rotation mid-cache).
 */

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const JWKS_TTL_MS = 60 * 60_000;
/** Tolerated clock skew when checking exp/iat. */
const SKEW_MS = 60_000;

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

async function getJwks(forceRefresh = false): Promise<Jwk[]> {
  if (
    !forceRefresh &&
    jwksCache &&
    Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS
  ) {
    return jwksCache.keys;
  }
  const res = await fetch(JWKS_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Google JWKS ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  jwksCache = { keys: body.keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(s, "base64url");
  // Copy into a plain ArrayBuffer — Buffer's pool-backed ArrayBufferLike
  // doesn't satisfy WebCrypto's BufferSource typing.
  const out = new Uint8Array(new ArrayBuffer(buf.length));
  out.set(buf);
  return out;
}

function decodeSegment<T>(segment: string): T {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
}

export interface OidcClaims {
  iss?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  email?: string;
  email_verified?: boolean;
}

/**
 * Pure claim validation, separated from the crypto so it can be unit-tested
 * without Google's keys. Returns null when valid, else the reason.
 */
export function claimProblem(
  claims: OidcClaims,
  expected: { audience: string; email: string },
  nowMs: number = Date.now(),
): string | null {
  if (
    claims.iss !== "https://accounts.google.com" &&
    claims.iss !== "accounts.google.com"
  ) {
    return `unexpected issuer ${claims.iss ?? "(none)"}`;
  }
  if (claims.aud !== expected.audience) {
    return `audience mismatch`;
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 < nowMs - SKEW_MS) {
    return "token expired";
  }
  if (claims.email !== expected.email || claims.email_verified !== true) {
    return `unexpected caller ${claims.email ?? "(none)"}`;
  }
  return null;
}

/**
 * Full verification: signature against Google's JWKS, then claims.
 * Throws with a short reason on any failure; returns the claims on success.
 */
export async function verifyGoogleOidc(
  token: string,
  expected: { audience: string; email: string },
): Promise<OidcClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [headerB64, payloadB64, sigB64] = parts;

  const header = decodeSegment<{ alg?: string; kid?: string }>(headerB64);
  if (header.alg !== "RS256") throw new Error(`unexpected alg ${header.alg}`);
  if (!header.kid) throw new Error("token has no kid");

  let jwk = (await getJwks()).find((k) => k.kid === header.kid);
  if (!jwk) {
    // Key rotated since we cached — refresh once before giving up.
    jwk = (await getJwks(true)).find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error("no matching Google key");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw new Error("bad signature");

  const claims = decodeSegment<OidcClaims>(payloadB64);
  const problem = claimProblem(claims, expected);
  if (problem) throw new Error(problem);
  return claims;
}
