/**
 * Who is signed in. The page calls this on load: 200 shows the dashboard,
 * 401 shows the sign-in screen. A Google sign-in is renewed here once it has
 * less than 60 of its 90 days left, so anyone who opens the dashboard at
 * least every two months never has to sign in again.
 */
import { NextResponse } from "next/server";
import { requestAccount } from "@/lib/auth-ingest";
import {
  GOOGLE_RENEW_BELOW_SECONDS,
  GOOGLE_SESSION_SECONDS,
  SESSION_COOKIE,
  getRequestSession,
  googleConfigured,
  isHttps,
  newGoogleSession,
  nowSeconds,
  serializeCookie,
  sessionSecret,
  signToken,
} from "@/lib/dad-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const account = requestAccount(req);
  if (!account) {
    return NextResponse.json(
      { ok: false, signedIn: false, googleConfigured: googleConfigured() },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const res = NextResponse.json(
    { ok: true, signedIn: true, account: { kind: account.kind, name: account.name, role: account.role } },
    { headers: { "Cache-Control": "no-store" } },
  );
  const session = getRequestSession(req);
  if (session?.kind === "google" && session.exp - nowSeconds() < GOOGLE_RENEW_BELOW_SECONDS) {
    res.headers.append(
      "Set-Cookie",
      serializeCookie(SESSION_COOKIE, signToken(newGoogleSession(session.email), sessionSecret()), {
        maxAge: GOOGLE_SESSION_SECONDS,
        secure: isHttps(req),
      }),
    );
  }
  return res;
}
