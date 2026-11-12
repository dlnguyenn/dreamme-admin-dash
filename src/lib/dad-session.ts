/**
 * Per-person sign-in for the DAD (replaces the shared team password).
 *
 * People sign in with Google. Who may sign in, and as what, comes from two
 * Vercel env vars read on every request, so removing an email locks that
 * person out on the next deploy:
 *   DAD_ADMIN_EMAILS   comma-separated, full access
 *   DAD_VIEWER_EMAILS  comma-separated, the viewer ("user") tabs only
 *
 * Claude sessions sign in with their own key (table dad_claude_keys, one row
 * per computer, revocable). A helper script trades the key for a sign-in link
 * that works once within 2 minutes; see /api/auth/claude-link.
 *
 * A sign-in is an HttpOnly cookie holding a signed payload (HMAC-SHA256). No
 * emails, secrets or allowlists live in this repo: it is public.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "dad_session";
export const OAUTH_STATE_COOKIE = "dad_oauth";
/** People stay signed in 90 days, renewed whenever the page loads. */
export const GOOGLE_SESSION_SECONDS = 90 * 24 * 3600;
/** Renew when less than this is left (so an active person never expires). */
export const GOOGLE_RENEW_BELOW_SECONDS = 60 * 24 * 3600;
/** Claude sessions are short: long enough to check a few pages. */
export const CLAUDE_SESSION_SECONDS = 12 * 3600;
export const LINK_TICKET_SECONDS = 120;
export const OAUTH_STATE_SECONDS = 10 * 60;

export type DadRole = "admin" | "user";

export type GoogleSession = {
  v: 1;
  typ: "session";
  kind: "google";
  email: string;
  iat: number;
  exp: number;
};
export type ClaudeSession = {
  v: 1;
  typ: "session";
  kind: "claude";
  kid: string;
  label: string;
  iat: number;
  exp: number;
};
export type SessionPayload = GoogleSession | ClaudeSession;
export type LinkTicket = {
  v: 1;
  typ: "ticket";
  kid: string;
  label: string;
  next: string;
  jti: string;
  exp: number;
};
export type OAuthState = {
  v: 1;
  typ: "oauth";
  state: string;
  nonce: string;
  next: string;
  exp: number;
};

export interface DadAccount {
  kind: "google" | "claude" | "dev";
  /** Email for people, the key's label for Claude. Never sent to third parties. */
  name: string;
  role: DadRole;
  kid?: string;
}

type Env = Record<string, string | undefined>;

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// Signing

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * The signing secret. DAD_SESSION_SECRET if set; otherwise derived from the
 * Supabase service-role key (already a secret the server holds, and anyone who
 * has it can read everything anyway), so no new env var is required. Empty
 * string = signing disabled, and every sign-in check fails closed.
 */
export function sessionSecret(env: Env = process.env): string {
  if (env.DAD_SESSION_SECRET) return env.DAD_SESSION_SECRET;
  const base =
    env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!base) return "";
  return createHmac("sha256", base).update("dad-session-v1").digest("hex");
}

export function signToken(payload: object, secret: string): string {
  if (!secret) throw new Error("DAD session secret is not configured");
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const mac = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${mac}`;
}

/** Returns the payload if the signature is good, the type matches and it hasn't expired. */
export function verifyToken<T extends { typ: string; exp: number }>(
  token: string | null | undefined,
  secret: string,
  typ: T["typ"],
  now: number = nowSeconds(),
): T | null {
  if (!token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const want = createHmac("sha256", secret).update(body).digest();
  let got: Buffer;
  try {
    got = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let payload: T;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
  if (!payload || payload.typ !== typ) return null;
  if (typeof payload.exp !== "number" || payload.exp <= now) return null;
  return payload;
}

export function randomId(bytes = 16): string {
  return b64url(randomBytes(bytes));
}

// ---------------------------------------------------------------------------
// Who may sign in

export function parseEmailList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\s;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes("@"));
}

export function roleForEmail(email: string, env: Env = process.env): DadRole | null {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  if (parseEmailList(env.DAD_ADMIN_EMAILS).includes(e)) return "admin";
  if (parseEmailList(env.DAD_VIEWER_EMAILS).includes(e)) return "user";
  return null;
}

export function claudeRole(env: Env = process.env): DadRole {
  return env.DAD_CLAUDE_ROLE === "user" ? "user" : "admin";
}

/**
 * Turns a verified session into an account, re-checking the allowlist so a
 * removed email stops working without anyone having to sign out. (Claude keys
 * are re-checked against the database in src/middleware.ts.)
 */
export function accountFromSession(p: SessionPayload, env: Env = process.env): DadAccount | null {
  if (p.kind === "google") {
    const role = roleForEmail(p.email, env);
    return role ? { kind: "google", name: p.email, role } : null;
  }
  if (p.kind === "claude") {
    if (!p.kid) return null;
    return { kind: "claude", name: p.label || "Claude", role: claudeRole(env), kid: p.kid };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cookies

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function isHttps(req: Request): boolean {
  try {
    if (new URL(req.url).protocol === "https:") return true;
  } catch {}
  return (req.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAge: number; secure: boolean },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`,
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(name: string, secure: boolean): string {
  return serializeCookie(name, "", { maxAge: 0, secure });
}

export function getRequestSession(
  req: Request,
  env: Env = process.env,
  now: number = nowSeconds(),
): SessionPayload | null {
  return verifyToken<SessionPayload>(readCookie(req, SESSION_COOKIE), sessionSecret(env), "session", now);
}

export function getRequestAccount(
  req: Request,
  env: Env = process.env,
  now: number = nowSeconds(),
): DadAccount | null {
  const p = getRequestSession(req, env, now);
  return p ? accountFromSession(p, env) : null;
}

export function newGoogleSession(email: string, now: number = nowSeconds()): GoogleSession {
  return {
    v: 1,
    typ: "session",
    kind: "google",
    email: email.trim().toLowerCase(),
    iat: now,
    exp: now + GOOGLE_SESSION_SECONDS,
  };
}

export function newClaudeSession(kid: string, label: string, now: number = nowSeconds()): ClaudeSession {
  return { v: 1, typ: "session", kind: "claude", kid, label, iat: now, exp: now + CLAUDE_SESSION_SECONDS };
}

/** Only same-site paths: "/x?y" yes; "//evil", "/\\evil", "https://..." no. */
export function safeNext(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f]/.test(next)) return "/";
  return next.slice(0, 500);
}

// ---------------------------------------------------------------------------
// Claude keys

export const CLAUDE_KEY_PREFIX = "dadck_";

export function newClaudeKey(): string {
  return CLAUDE_KEY_PREFIX + randomId(32);
}

export function hashClaudeKey(key: string): string {
  return createHash("sha256").update(key.trim(), "utf8").digest("hex");
}

export function looksLikeClaudeKey(key: string | null | undefined): key is string {
  return !!key && key.startsWith(CLAUDE_KEY_PREFIX) && key.length >= CLAUDE_KEY_PREFIX.length + 40;
}

// ---------------------------------------------------------------------------
// Google sign-in (OpenID Connect, authorization-code flow)

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export function googleConfigured(env: Env = process.env): boolean {
  return !!env.GOOGLE_OAUTH_CLIENT_ID && !!env.GOOGLE_OAUTH_CLIENT_SECRET;
}

export function googleAuthUrl(o: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
}): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: "openid email",
    state: o.state,
    nonce: o.nonce,
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${q.toString()}`;
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Checks the claims of the ID token Google's token endpoint returned. The token
 * came straight from Google over TLS in exchange for our client secret, so
 * (per OpenID Connect Core 3.1.3.7) the TLS server check stands in for the
 * signature check; the claims still have to match.
 */
export function checkGoogleIdClaims(
  claims: Record<string, unknown> | null,
  o: { clientId: string; nonce: string; now?: number },
): { email: string } | { error: string } {
  const now = o.now ?? nowSeconds();
  if (!claims) return { error: "bad_token" };
  const iss = claims.iss;
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com") return { error: "bad_issuer" };
  const aud = claims.aud;
  const audOk = Array.isArray(aud) ? aud.includes(o.clientId) : aud === o.clientId;
  if (!audOk) return { error: "bad_audience" };
  if (typeof claims.exp !== "number" || claims.exp <= now) return { error: "expired" };
  if (claims.nonce !== o.nonce) return { error: "bad_nonce" };
  if (claims.email_verified !== true && claims.email_verified !== "true") return { error: "unverified_email" };
  if (typeof claims.email !== "string" || !claims.email.includes("@")) return { error: "no_email" };
  return { email: claims.email.toLowerCase() };
}

// ---------------------------------------------------------------------------
// Localhost development

/**
 * In `next dev` on a loopback host, the server treats every request as an
 * admin so the dashboard can be checked without signing in (as before).
 * NODE_ENV is inlined at build time, so this is dead code on Vercel.
 * DAD_DEV_AUTH=real turns it off to test real sign-in locally.
 */
export function devBypassActive(req: Request, env: Env = process.env): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  if (env.DAD_DEV_AUTH === "real") return false;
  return isLoopbackRequest(req);
}

export function isLoopbackRequest(req: Request): boolean {
  let host = "";
  try {
    host = new URL(req.url).hostname;
  } catch {}
  const header = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  const loop = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  return loop(host) && (header === "" || loop(header));
}

/** The dev stand-in for Google (see /api/auth/dev-google). Dead code on Vercel. */
export function devFakeGoogleActive(req: Request, env: Env = process.env): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  return env.DAD_DEV_FAKE_GOOGLE === "1" && isLoopbackRequest(req);
}
