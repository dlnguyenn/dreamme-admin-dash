/**
 * Revoking a Claude key locks Claude out at once: for any API request that
 * carries a Claude session cookie, check the key is still live in
 * dad_claude_keys (cached 30 s per instance). People's Google sessions and
 * token-authenticated requests pass straight through; the routes themselves
 * check signatures and allowlists (src/lib/auth-ingest.ts).
 *
 * Runs on the edge runtime, so no node:crypto here: it only reads the cookie's
 * payload. A forged cookie gets no further than the route's signature check.
 */
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "dad_session";
const CACHE_MS = 30_000;
const cache = new Map<string, { live: boolean; at: number }>();

function claudeKid(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const body = cookie.split(".")[0];
  try {
    const json = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
    const p = JSON.parse(json) as { kind?: string; kid?: string };
    return p.kind === "claude" && typeof p.kid === "string" ? p.kid : null;
  } catch {
    return null;
  }
}

async function keyLive(kid: string): Promise<boolean> {
  const hit = cache.get(kid);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.live;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key =
    process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key || !/^[0-9a-f-]{36}$/i.test(kid)) return false;
  let live = false;
  try {
    const res = await fetch(
      `${url}/rest/v1/dad_claude_keys?select=id&id=eq.${kid}&revoked_at=is.null&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" },
    );
    live = res.ok && ((await res.json()) as unknown[]).length > 0;
  } catch {
    live = false;
  }
  cache.set(kid, { live, at: Date.now() });
  return live;
}

export async function middleware(req: NextRequest) {
  // Signing in, out or opening a new link must work even with a dead cookie.
  const p = req.nextUrl.pathname;
  if (p.startsWith("/api/auth/") && p !== "/api/auth/me") return NextResponse.next();
  const kid = claudeKid(req.cookies.get(SESSION_COOKIE)?.value);
  if (!kid) return NextResponse.next();
  if (await keyLive(kid)) return NextResponse.next();
  const res = NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
  return res;
}

export const config = { matcher: ["/api/:path*"] };
