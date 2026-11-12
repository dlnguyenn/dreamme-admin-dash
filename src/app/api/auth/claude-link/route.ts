/**
 * Trades a Claude key for a sign-in link. Called by the vault script
 * `.claude-setup/team/dad-signin.js link` (server to server, never from a
 * page). The link works once, within 2 minutes; opening it in a browser signs
 * that browser in as Claude for 12 hours.
 *
 *   POST /api/auth/claude-link   header x-dad-claude-key: <key>
 *   body (optional) { "next": "/?tab=experiments" }
 *   -> { ok: true, url, expiresInSeconds }
 */
import { NextResponse } from "next/server";
import {
  LINK_TICKET_SECONDS,
  nowSeconds,
  randomId,
  safeNext,
  sessionSecret,
  signToken,
  type LinkTicket,
} from "@/lib/dad-session";
import { findLiveClaudeKey, openClaudeTicket } from "@/lib/dad-claude-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = sessionSecret();
  if (!secret) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  let row;
  try {
    row = await findLiveClaudeKey(req.headers.get("x-dad-claude-key"));
  } catch {
    return NextResponse.json({ ok: false, error: "lookup_failed" }, { status: 502 });
  }
  if (!row) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { next?: unknown };
  const ticket: LinkTicket = {
    v: 1,
    typ: "ticket",
    kid: row.id,
    label: row.label,
    next: safeNext(typeof body.next === "string" ? body.next : "/"),
    jti: randomId(),
    exp: nowSeconds() + LINK_TICKET_SECONDS,
  };
  await openClaudeTicket(row.id, ticket.jti);
  const url = `${new URL(req.url).origin}/api/auth/link?t=${encodeURIComponent(signToken(ticket, secret))}`;
  return NextResponse.json(
    { ok: true, url, expiresInSeconds: LINK_TICKET_SECONDS },
    { headers: { "Cache-Control": "no-store" } },
  );
}
