/**
 * Begin the "Login with Facebook" flow: validate the admin password (v1
 * single-tenant gate), set a signed CSRF state cookie, and redirect to the
 * Facebook Login dialog. The dialog returns to /api/oauth/meta/callback.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_PASSWORD, safeStringEq } from "@/lib/mcp-oauth";
import {
  metaOAuthConfigured,
  buildAuthUrl,
  createState,
  defaultScopes,
} from "@/lib/meta-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function origin(req: NextRequest): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export function GET(req: NextRequest) {
  const url = new URL(req.url);
  const admin = url.searchParams.get("admin") ?? "";
  if (!admin || !safeStringEq(admin, ADMIN_PASSWORD)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!metaOAuthConfigured()) {
    return NextResponse.json(
      { error: "Meta OAuth not configured (set META_OAUTH_APP_ID, META_OAUTH_CLIENT_SECRET)." },
      { status: 503 },
    );
  }

  const o = origin(req);
  const redirectUri = `${o}/api/oauth/meta/callback`;
  const state = createState();
  const authUrl = buildAuthUrl({ redirectUri, state, scopes: defaultScopes() });

  const res = NextResponse.redirect(authUrl, { status: 302 });
  res.cookies.set("meta_oauth_state", state, {
    httpOnly: true,
    secure: o.startsWith("https"),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
