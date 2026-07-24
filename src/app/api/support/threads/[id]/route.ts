/**
 * GET  /api/support/threads/[id] — full thread detail (messages, latest
 *      drafts, action log). Marks the thread read.
 * PATCH /api/support/threads/[id] — {status?, snoozed_until?, unread?}
 *      (close / snooze / reopen / mark unread).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  getThread,
  getThreadActions,
  getThreadDrafts,
  getThreadMessages,
  patchThread,
  supportDbConfigured,
} from "@/lib/support/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Patch = z
  .object({
    status: z
      .enum(["new", "drafts_ready", "waiting_user", "closed", "ignored"])
      .optional(),
    snoozed_until: z.string().datetime({ offset: true }).nullable().optional(),
    unread: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty patch" });

function unauthorized() {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkIngestAuth(req)) return unauthorized();
  if (!supportDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }
  const { id } = await params;
  try {
    const thread = await getThread(id);
    if (!thread) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    const [messages, drafts, actions] = await Promise.all([
      getThreadMessages(id),
      getThreadDrafts(id),
      getThreadActions(id),
    ]);
    if (thread.unread) {
      await patchThread(id, { unread: false }).catch(() => {});
      thread.unread = false;
    }
    return NextResponse.json({ ok: true, thread, messages, drafts, actions });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!checkIngestAuth(req)) return unauthorized();
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const parsed = Patch.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const thread = await patchThread(id, parsed.data);
    if (!thread) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, thread });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
