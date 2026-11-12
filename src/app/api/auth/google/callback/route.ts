/**
 * Google sends the browser back here. Checks the state cookie, trades the code
 * for an ID token (server to server, with our client secret), checks the
 * token's claims and the email allowlist, then sets the 90-day session cookie.
 * Any failure lands on the sign-in page with a short reason code.
 */
import { NextResponse } from "next/server";
import {
  GOOGLE_SESSION_SECONDS,
  GOOGLE_TOKEN_URL,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  checkGoogleIdClaims,
  clearCookie,
  decodeJwtPayload,
  devFakeGoogleActive,
  isHttps,
  newGoogleSession,
  nowSeconds,
  readCookie,
  roleForEmail,
  serializeCookie,
  sessionSecret,
  signToken,
  verifyToken,
  type OAuthState,
} from "@/lib/dad-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEV_CLIENT_ID = "dev-fake-google";

async function claimsFor(req: Request, code: string, redirectUri: string): Promise<Record<string, unknown> | null> {
  if (code.startsWith("dev:")) {
    // Stand-in for Google on localhost only (see /api/auth/dev-google).
    if (!devFakeGoogleActive(req)) return null;
    try {
      const { email, nonce } = JSON.parse(Buffer.from(code.slice(4), "base64url").toString("utf8"));
      return {
        iss: "https://accounts.google.com",
        aud: DEV_CLIENT_ID,
        exp: nowSeconds() + 300,
        nonce,
        email,
        email_verified: true,
      };
    } catch {
      return null;
    }
  }
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as { id_token?: string } | null;
  return json?.id_token ? decodeJwtPayload(json.id_token) : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const secure = isHttps(req);
  const fail = (reason: string) => {
    const res = NextResponse.redirect(`${origin}/?signin=${reason}`, 303);
    res.headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE, secure));
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  const secret = sessionSecret();
  if (!secret) return fail("not_configured");
  if (url.searchParams.get("error")) return fail("cancelled");

  const state = verifyToken<OAuthState>(readCookie(req, OAUTH_STATE_COOKIE), secret, "oauth");
  const code = url.searchParams.get("code");
  if (!state || !code || url.searchParams.get("state") !== state.state) return fail("expired");

  let claims: Record<string, unknown> | null = null;
  try {
    claims = await claimsFor(req, code, `${origin}/api/auth/google/callback`);
  } catch {
    return fail("error");
  }
  const clientId = code.startsWith("dev:") ? DEV_CLIENT_ID : process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
  const checked = checkGoogleIdClaims(claims, { clientId, nonce: state.nonce });
  if ("error" in checked) return fail("error");
  if (!roleForEmail(checked.email)) return fail("denied");

  const res = NextResponse.redirect(`${origin}${state.next}`, 303);
  res.headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE, secure));
  res.headers.append(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, signToken(newGoogleSession(checked.email), secret), {
      maxAge: GOOGLE_SESSION_SECONDS,
      secure,
    }),
  );
  res.headers.set("Cache-Control", "no-store");
  return res;
}
