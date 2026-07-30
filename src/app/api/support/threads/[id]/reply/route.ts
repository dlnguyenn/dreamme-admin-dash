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
  spDelete,
  spGet,
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
  /**
   * Minted once per confirm dialog. Two clicks (or a retry, or a second
   * tab) carry the SAME key, which we claim atomically below — a
   * read-then-write duplicate check races and lets simultaneous sends
   * through, as proven in testing.
   */
  idempotencyKey: z.string().min(8).max(80).optional(),
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
    const isAlias = (e: string | null | undefined) =>
      !!e && ["help@dreamme.life", "feedback@dreamme.life"].includes(e.toLowerCase());
    let to = thread.counterpart_email ?? parsed.data.to ?? null;
    // A Google-Group DMARC rewrite can leave counterpart_email as our own
    // alias (pre-fix threads) — let an explicit `to` override it.
    if (isAlias(to) && parsed.data.to && !isAlias(parsed.data.to)) {
      to = parsed.data.to;
    }
    if (!to) {
      return NextResponse.json(
        { ok: false, error: "thread has no reply email — pass `to`" },
        { status: 400 },
      );
    }
    // Never mail ourselves.
    if (isAlias(to)) {
      return NextResponse.json(
        {
          ok: false,
          error: `refusing to send to our own alias (${to}) — the real sender wasn't resolved on this thread; pass \`to\` explicitly`,
        },
        { status: 400 },
      );
    }

    // --- duplicate-send guards ---------------------------------------
    // A double "Send this reply" once emailed a user twice. The UI now
    // locks synchronously, but tabs/retries/races still need a server
    // backstop. Cheap checks first, then an ATOMIC claim.
    if (parsed.data.draftId) {
      const drafts = await spGet<Array<{ status: string }>>(
        `support_drafts?id=eq.${encodeURIComponent(parsed.data.draftId)}&select=status&limit=1`,
      );
      if (drafts[0]?.status === "sent") {
        return NextResponse.json(
          { ok: false, error: "this draft was already sent" },
          { status: 409 },
        );
      }
    }

    const messages = await getThreadMessages(id);
    const cutoff = Date.now() - 10 * 60_000;
    const duplicate = messages.some(
      (m) =>
        m.direction === "outbound" &&
        new Date(m.sent_at).getTime() > cutoff &&
        (m.body_text ?? "").trim() === parsed.data.body.trim(),
    );
    if (duplicate) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "an identical reply was sent on this thread minutes ago — refusing the duplicate",
        },
        { status: 409 },
      );
    }

    // Atomic claim: insert the outbound row BEFORE sending, keyed on the
    // dialog's idempotency key via the unique message_id index. Two
    // simultaneous requests both reach here; exactly one insert wins and
    // the loser gets zero rows back. (A read-then-write check does NOT
    // survive this — verified: 4 concurrent sends all passed it.)
    const claimKey = `<claim-${parsed.data.idempotencyKey ?? crypto.randomUUID()}@dreamme.life>`;
    const claimed = await spPost<{ id: string }>(
      "support_messages",
      [
        {
          thread_id: id,
          direction: "outbound",
          via: "email",
          message_id: claimKey,
          from_email: process.env.SUPPORT_FROM_EMAIL ?? "dan@dreamme.life",
          to_email: to,
          subject: replySubject(thread.subject),
          body_text: parsed.data.body,
          sent_at: new Date().toISOString(),
        },
      ],
      { onConflict: "message_id", resolution: "ignore" },
    );
    if (claimed.length === 0) {
      return NextResponse.json(
        { ok: false, error: "this reply is already being sent" },
        { status: 409 },
      );
    }
    const claimId = claimed[0].id;

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
    let sent: Awaited<ReturnType<typeof sendSupportReply>>;
    try {
      sent = await sendSupportReply({
        to,
        subject,
        bodyText: parsed.data.body,
        inReplyTo: lastInbound?.message_id ?? null,
        references: chain,
      });
    } catch (sendErr) {
      // Release the claim so a genuine retry isn't blocked by a send that
      // never happened.
      await spDelete(`support_messages?id=eq.${claimId}`).catch(() => {});
      throw sendErr;
    }

    // Promote the claim row to the real sent message (its Message-ID is
    // what future user replies thread against).
    const nowIso = new Date().toISOString();
    await spPatch(`support_messages?id=eq.${claimId}`, {
      message_id: sent.messageId,
      in_reply_to: lastInbound?.message_id ?? null,
      references_ids: chain,
      sent_at: nowIso,
    });

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
