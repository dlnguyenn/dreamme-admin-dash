/**
 * Starts "Sign in with Google": remembers a random state + nonce in a short
 * signed cookie, then sends the browser to Google. The callback checks both.
 */
import { NextResponse } from "next/server";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_SECONDS,
  devFakeGoogleActive,
  googleAuthUrl,
  googleConfigured,
  isHttps,
  nowSeconds,
  randomId,
  safeNext,
  serializeCookie,
  sessionSecret,
  signToken,
  type OAuthState,
} from "@/lib/dad-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const fake = devFakeGoogleActive(req);
  const secret = sessionSecret();
  if ((!googleConfigured() && !fake) || !secret) {
    return NextResponse.redirect(`${origin}/?signin=not_configured`, 303);
  }
  const state: OAuthState = {
    v: 1,
    typ: "oauth",
    state: randomId(),
    nonce: randomId(),
    next: safeNext(url.searchParams.get("next")),
    exp: nowSeconds() + OAUTH_STATE_SECONDS,
  };
  const redirectUri = `${origin}/api/auth/google/callback`;
  const target = fake
    ? `${origin}/api/auth/dev-google?${new URLSearchParams({ state: state.state, nonce: state.nonce })}`
    : googleAuthUrl({
        clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!,
        redirectUri,
        state: state.state,
        nonce: state.nonce,
      });
  const res = NextResponse.redirect(target, 303);
  res.headers.append(
    "Set-Cookie",
    serializeCookie(OAUTH_STATE_COOKIE, signToken(state, secret), {
      maxAge: OAUTH_STATE_SECONDS,
      secure: isHttps(req),
    }),
  );
  res.headers.set("Cache-Control", "no-store");
  return res;
}
