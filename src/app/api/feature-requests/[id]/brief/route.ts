/**
 * POST /api/feature-requests/:id/brief — (re)build a ticket's details.
 *
 * For tickets filed before details existed, and for manual ones. When the
 * row links a support thread (details.threadUrl, or the "Support thread:"
 * line older rows carry in their description), the requester snapshot,
 * quote and screenshots come from that thread, same as Create ticket.
 * Otherwise the brief is written from the title and description alone.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { messageText } from "@/lib/support/email-text";
import {
  getThread,
  getThreadMessages,
  spGet,
  spPatch,
  supportDbConfigured,
} from "@/lib/support/db";
import {
  generateBrief,
  quoteFrom,
  requesterSnapshot,
  threadIdFromText,
  ticketDetails,
  trelloUrlFromText,
} from "@/lib/support/ticket-brief";
import type { FeatureRequestRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!supportDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured" },
      { status: 500 },
    );
  }
  const { id } = await params;

  try {
    const [row] = await spGet<FeatureRequestRow[]>(
      `feature_requests?id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    if (!row) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const prior = row.details;
    const threadId =
      threadIdFromText(prior?.threadUrl) ?? threadIdFromText(row.description);
    const thread = threadId ? await getThread(threadId) : null;
    const messages = thread ? await getThreadMessages(thread.id) : [];
    const firstInbound = messages.find((m) => m.direction === "inbound");
    const quote = firstInbound
      ? quoteFrom(messageText(firstInbound.body_text, firstInbound.body_html))
      : (prior?.quote ?? null);

    const brief = await generateBrief({
      title: row.title,
      quote,
      requester: thread ? requesterSnapshot(thread) : (prior?.requester ?? null),
      // Without a thread the description is all there is to go on; with
      // one, it is just the quote again plus links.
      notes: thread ? null : row.description,
    });
    if (!brief) {
      return NextResponse.json(
        { ok: false, error: "brief generation returned nothing (ANTHROPIC_API_KEY?)" },
        { status: 502 },
      );
    }

    // Keep the link the ticket already has: rebuilding it from this
    // request's origin would point at localhost when run from a dev server.
    const existingThreadUrl =
      prior?.threadUrl ??
      row.description.match(/https?:\/\/\S+[?&]thread=[0-9a-f-]{36}/i)?.[0] ??
      null;
    const details = ticketDetails({
      thread,
      messages,
      quote,
      brief,
      threadUrl:
        existingThreadUrl ??
        (thread
          ? `${new URL(req.url).origin}/?tab=support&thread=${encodeURIComponent(thread.id)}`
          : null),
      trelloUrl: prior?.trelloUrl ?? trelloUrlFromText(row.description),
      receivedAt: firstInbound?.sent_at ?? prior?.receivedAt ?? null,
    });
    if (!thread && prior?.requester) details.requester = prior.requester;

    const patch: Record<string, unknown> = {
      details,
      updated_at: new Date().toISOString(),
    };
    // Seed the epic only when nobody has set one; never overwrite a choice.
    if (!row.epic) patch.epic = brief.area;
    if (!row.submitter_email && details.requester?.email) {
      patch.submitter_email = details.requester.email;
    }

    const [updated] = await spPatch<FeatureRequestRow>(
      `feature_requests?id=eq.${encodeURIComponent(id)}`,
      patch,
    );
    return NextResponse.json({ ok: true, row: updated });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
