/**
 * Facebook Login callback: verify the CSRF state cookie, exchange the code for
 * a long-lived Meta token, capture the user + granted ad accounts, and store
 * the connection. Redirects back to the dashboard Integrations panel.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  verifyState,
  exchangeCodeForToken,
  exchangeForLongLived,
  fetchIdentityAndAdAccounts,
  saveConnection,
  defaultScopes,
} from "@/lib/meta-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function origin(req: NextRequest): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

function back(o: string, params: Record<string, string>): NextResponse {
  const u = new URL(`${o}/`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = NextResponse.redirect(u.toString(), { status: 302 });
  res.cookies.set("meta_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const o = origin(req);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const fbError = url.searchParams.get("error_description") || url.searchParams.get("error");

  if (fbError) return back(o, { meta: "error", reason: fbError.slice(0, 140) });

  const cookieState = req.cookies.get("meta_oauth_state")?.value ?? "";
  if (!code || !state || state !== cookieState || !verifyState(state)) {
    return back(o, { meta: "error", reason: "Invalid or expired state — restart the connection." });
  }

  try {
    const redirectUri = `${o}/api/oauth/meta/callback`;
    const shortToken = await exchangeCodeForToken({ code, redirectUri });
    const { token, expiresInSec } = await exchangeForLongLived(shortToken);
    const identity = await fetchIdentityAndAdAccounts(token);
    await saveConnection({ token, expiresInSec, identity, scopes: defaultScopes() });
    return back(o, { meta: "connected" });
  } catch (e) {
    return back(o, { meta: "error", reason: (e instanceof Error ? e.message : String(e)).slice(0, 140) });
  }
}
