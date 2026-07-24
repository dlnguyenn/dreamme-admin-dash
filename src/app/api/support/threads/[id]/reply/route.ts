/**
 * POST /api/support/threads/[id]/reply — send a reply via SMTP.
 *
 * Body: { body: string, draftId?: string, to?: string }
 *  - `to` is only honored when the thread has no counterpart email (manual
 *    override for feedback rows without reply_email).
 *
 * Threads the reply onto the email conversation via In-Reply-To/References,
 * stores the outbound message row (with OUR generated Message-ID, so future
 * user replies match back to this thread), marks the draft sent, and flips
 * the thread to waiting_user. Nothing is ever sent automatically — this
 * route only fires from an explicit click in the UI.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  getThread,
  getThreadMessages,
  patchThread,
  spPatch,
  spPost,
  supportDbConfigured,
} from "@/lib/support/db";
import {
  mailerConfigured,
  replySubject,
  sendSupportReply,
} from "@/lib/support/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  body: z.string().min(1).max(20_000),
  draftId: z.string().uuid().optional(),
  to: z.string().email().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!supportDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }
  if (!mailerConfigured()) {
    return NextResponse.json(
      { ok: false, error: "DREAMME_SMTP_PASS not set" },
      { status: 503 },
    );
  }

  const { id } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const thread = await getThread(id);
    if (!thread) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    const to = thread.counterpart_email ?? parsed.data.to ?? null;
    if (!to) {
      return NextResponse.json(
        { ok: false, error: "thread has no reply email — pass `to`" },
        { status: 400 },
      );
    }

    const messages = await getThreadMessages(id);
    const lastInbound = [...messages]
      .reverse()
      .find((m) => m.direction === "inbound" && m.via === "email");
    // Full chain, oldest first, deduped.
    const chain: string[] = [];
    for (const m of messages) {
      for (const ref of [...(m.references_ids ?? []), m.message_id]) {
        if (ref && !chain.includes(ref)) chain.push(ref);
      }
    }

    const subject = replySubject(thread.subject);
    const sent = await sendSupportReply({
      to,
      subject,
      bodyText: parsed.data.body,
      inReplyTo: lastInbound?.message_id ?? null,
      references: chain,
    });

    const nowIso = new Date().toISOString();
    await spPost("support_messages", [
      {
        thread_id: id,
        direction: "outbound",
        via: "email",
        message_id: sent.messageId,
        in_reply_to: lastInbound?.message_id ?? null,
        references_ids: chain,
        from_email: process.env.SUPPORT_FROM_EMAIL ?? "dan@dreamme.life",
        to_email: to,
        subject,
        body_text: parsed.data.body,
        sent_at: nowIso,
      },
    ]);

    if (parsed.data.draftId) {
      await spPatch(
        `support_drafts?id=eq.${encodeURIComponent(parsed.data.draftId)}`,
        { status: "sent", updated_at: nowIso },
      ).catch(() => {});
    }
    await patchThread(id, {
      status: "waiting_user",
      unread: false,
      last_message_at: nowIso,
    });

    return NextResponse.json({ ok: true, messageId: sent.messageId, to });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
