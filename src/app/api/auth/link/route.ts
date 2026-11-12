/**
 * Opens a Claude sign-in link (see /api/auth/claude-link): checks the
 * signature and 2-minute expiry, uses the link up (single use, key not
 * revoked), then sets a 12-hour Claude session cookie.
 */
import { NextResponse } from "next/server";
import {
  CLAUDE_SESSION_SECONDS,
  SESSION_COOKIE,
  isHttps,
  newClaudeSession,
  serializeCookie,
  sessionSecret,
  signToken,
  verifyToken,
  type LinkTicket,
} from "@/lib/dad-session";
import { redeemClaudeTicket } from "@/lib/dad-claude-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const secret = sessionSecret();
  const ticket = verifyToken<LinkTicket>(url.searchParams.get("t"), secret, "ticket");
  let ok = false;
  if (ticket) {
    try {
      ok = await redeemClaudeTicket(ticket.kid, ticket.jti);
    } catch {
      ok = false;
    }
  }
  if (!ticket || !ok) {
    return NextResponse.redirect(`${origin}/?signin=link_expired`, { status: 303, headers: { "Cache-Control": "no-store" } });
  }
  const res = NextResponse.redirect(`${origin}${ticket.next}`, 303);
  res.headers.append(
    "Set-Cookie",
    serializeCookie(SESSION_COOKIE, signToken(newClaudeSession(ticket.kid, ticket.label), secret), {
      maxAge: CLAUDE_SESSION_SECONDS,
      secure: isHttps(req),
    }),
  );
  res.headers.set("Cache-Control", "no-store");
  // Keep the one-time link out of the Referer of anything the page loads.
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
