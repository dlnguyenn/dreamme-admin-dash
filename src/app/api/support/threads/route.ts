/**
 * GET /api/support/threads — thread list for the Support Inbox tab.
 *
 * Query params:
 *   ?status=new|drafts_ready|waiting_user|closed|ignored (optional; default
 *     hides closed+ignored)
 *   ?status=feature_requests — the Feature requests folder: threads tagged
 *     FEATURE REQUEST whose customer last wrote >24h ago, any status but
 *     ignored. Those threads are left out of every other status view and of
 *     the unread / needs-attention badges (see inFeatureRequestFolder).
 *   ?q=jane — search counterpart name/email/subject across ALL statuses
 *     (finding a person matters regardless of closed/ignored); overrides
 *     the status filter
 *   ?countOnly=1 — just the badge counts (unread + needs attention)
 * Snoozed threads (snoozed_until in the future) are excluded unless their
 * status is explicitly requested.
 */
import { NextResponse } from "next/server";
import { readIngestHealth } from "@/lib/support/health";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { spGet, supportDbConfigured } from "@/lib/support/db";
import {
  inFeatureRequestFolder,
  needsAttention,
  type SupportThreadRow,
} from "@/lib/support/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["new", "drafts_ready", "waiting_user", "closed", "ignored"]);

// Columns inFeatureRequestFolder reads, for the badge queries that would
// otherwise select only ids.
const FOLDER_COLS = "source,subject,triage,last_inbound_at,created_at,feature_request_moved_at";

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
    const now = Date.now();
    const unreadRows = await spGet<SupportThreadRow[]>(
      `support_threads?select=id,status,${FOLDER_COLS}&unread=eq.true&status=not.in.(closed,ignored)&limit=100`,
    );
    const unreadCount = unreadRows.filter((t) => !inFeatureRequestFolder(t, now)).length;
    // Threads awaiting a reply, narrowed to >24h by the same rule the list
    // tags use, so the sidebar "!" and the NEEDS ATTENTION tags agree.
    const awaitingRows = await spGet<SupportThreadRow[]>(
      `support_threads?select=id,status,snoozed_until,${FOLDER_COLS}&status=in.(new,drafts_ready)&limit=500`,
    );
    const needsAttentionCount = awaitingRows.filter(
      (t) => needsAttention(t, now) && !inFeatureRequestFolder(t, now),
    ).length;
    if (countOnly) {
      return NextResponse.json({ ok: true, unreadCount, needsAttentionCount });
    }

    // Search mode: name/email/subject, every status, newest first.
    const q = url.searchParams.get("q")?.trim() ?? "";
    if (q) {
      // Strip characters PostgREST's or=() grammar or ilike patterns treat
      // specially, then wildcard both ends.
      const safe = q.replace(/[,()*%\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
      if (!safe) return NextResponse.json({ ok: true, threads: [], unreadCount, needsAttentionCount });
      const pat = encodeURIComponent(`*${safe}*`);
      const threads = await spGet<SupportThreadRow[]>(
        `support_threads?or=(counterpart_email.ilike.${pat},counterpart_name.ilike.${pat},subject.ilike.${pat})&order=last_message_at.desc&limit=100`,
      );
      return NextResponse.json({ ok: true, threads, unreadCount, needsAttentionCount, health: await readIngestHealth() });
    }

    // Queried on every load so the folder's pill count stays current from
    // any view. The or=() only narrows to possible feature requests;
    // inFeatureRequestFolder applies the exact tag rule and the 24h cutoff.
    const candidates = await spGet<SupportThreadRow[]>(
      `support_threads?status=neq.ignored&or=(feature_request_moved_at.not.is.null,triage->>feature_request.eq.true,subject.ilike.*feature_request*)&order=last_message_at.desc&limit=500`,
    );
    const folder = candidates.filter((t) => inFeatureRequestFolder(t, now));

    let visible: SupportThreadRow[];
    if (status === "feature_requests") {
      visible = folder;
    } else {
      const explicit = !!status && STATUSES.has(status);
      const filter = explicit ? `status=eq.${status}` : `status=not.in.(closed,ignored)`;
      const threads = await spGet<SupportThreadRow[]>(
        `support_threads?${filter}&order=last_message_at.desc&limit=200`,
      );
      // Foldered feature requests leave every status view. Snoozed threads
      // leave the default view only (still visible when their status is
      // explicitly filtered).
      visible = threads.filter(
        (t) =>
          !inFeatureRequestFolder(t, now) &&
          (explicit || !t.snoozed_until || new Date(t.snoozed_until).getTime() <= now),
      );
    }

    return NextResponse.json({
      ok: true,
      threads: visible,
      unreadCount,
      needsAttentionCount,
      featureRequestCount: folder.length,
      // Surfaced passively: the 2026-08-06 stall was invisible precisely
      // because nothing on screen distinguished "quiet" from "broken".
      health: await readIngestHealth(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
