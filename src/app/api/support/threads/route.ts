/**
 * GET /api/support/threads — thread list for the Support Inbox tab.
 *
 * Query params:
 *   ?status=new|drafts_ready|waiting_user|closed|ignored (optional; default
 *     hides closed+ignored)
 *   ?q=jane — search counterpart name/email/subject across ALL statuses
 *     (finding a person matters regardless of closed/ignored); overrides
 *     the status filter
 *   ?countOnly=1 — just the unread badge count
 * Snoozed threads (snoozed_until in the future) are excluded unless their
 * status is explicitly requested.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { spGet, supportDbConfigured } from "@/lib/support/db";
import type { SupportThreadRow } from "@/lib/support/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["new", "drafts_ready", "waiting_user", "closed", "ignored"]);

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!supportDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured" },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const countOnly = url.searchParams.get("countOnly") === "1";

  try {
    const unreadRows = await spGet<SupportThreadRow[]>(
      `support_threads?select=id&unread=eq.true&status=not.in.(closed,ignored)&limit=100`,
    );
    const unreadCount = unreadRows.length;
    if (countOnly) {
      return NextResponse.json({ ok: true, unreadCount });
    }

    // Search mode: name/email/subject, every status, newest first.
    const q = url.searchParams.get("q")?.trim() ?? "";
    if (q) {
      // Strip characters PostgREST's or=() grammar or ilike patterns treat
      // specially, then wildcard both ends.
      const safe = q.replace(/[,()*%\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
      if (!safe) return NextResponse.json({ ok: true, threads: [], unreadCount });
      const pat = encodeURIComponent(`*${safe}*`);
      const threads = await spGet<SupportThreadRow[]>(
        `support_threads?or=(counterpart_email.ilike.${pat},counterpart_name.ilike.${pat},subject.ilike.${pat})&order=last_message_at.desc&limit=100`,
      );
      return NextResponse.json({ ok: true, threads, unreadCount });
    }

    const filter =
      status && STATUSES.has(status)
        ? `status=eq.${status}`
        : `status=not.in.(closed,ignored)`;
    const threads = await spGet<SupportThreadRow[]>(
      `support_threads?${filter}&order=last_message_at.desc&limit=200`,
    );

    // Hide snoozed threads from the default view (still visible when their
    // status is explicitly filtered).
    const now = Date.now();
    const visible =
      status && STATUSES.has(status)
        ? threads
        : threads.filter(
            (t) => !t.snoozed_until || new Date(t.snoozed_until).getTime() <= now,
          );

    return NextResponse.json({ ok: true, threads: visible, unreadCount });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
