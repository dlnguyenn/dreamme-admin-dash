/**
 * POST /api/morning/queue — flip today's drafts to scheduled, or back.
 *
 * The client never sends a list of posts to queue. It sends an action, and the
 * server re-derives the targets from live Doublespeed state, because this
 * endpoint publishes to real accounts and a compromised or buggy client must
 * not be able to name arbitrary ids.
 *
 * `?dryRun=1` returns exactly what would be touched without touching it.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { liveDoublespeedPosts } from "@/lib/batchState";
import { doublespeedWriteConfigured, setPostStatus } from "@/lib/doublespeedWrite";
import { selectQueueTargets, selectUnqueueTargets } from "@/lib/morningQueue";
import { easternDate } from "@/lib/socialViews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A runaway loop here would be a bulk publish, so cap it hard. */
const MAX_BATCH = 40;

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!doublespeedWriteConfigured()) {
    return NextResponse.json(
      { ok: false, error: "DOUBLESPEED_API_KEY not configured" },
      { status: 500 },
    );
  }

  let body: { action?: string; ids?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    /* an empty body means the default action */
  }
  const action = body.action === "undo" ? "undo" : "queue";
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  try {
    const today = easternDate();
    // Two days back is enough to cover the Eastern-day boundary; the selector
    // filters to today regardless.
    const live = await liveDoublespeedPosts(
      new Date(Date.now() - 2 * 86_400_000),
    );
    const posts = [...live.values()];

    const targets =
      action === "undo"
        ? selectUnqueueTargets(posts, body.ids ?? [], today)
        : selectQueueTargets(posts, today).targets;
    const skipped =
      action === "undo" ? [] : selectQueueTargets(posts, today).skipped;

    if (targets.length > MAX_BATCH) {
      return NextResponse.json(
        {
          ok: false,
          error: `Refusing to ${action} ${targets.length} posts in one call (cap ${MAX_BATCH})`,
        },
        { status: 400 },
      );
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        action,
        date: today,
        targets,
        skipped,
      });
    }

    const nextStatus = action === "undo" ? "draft" : "scheduled";
    const done: typeof targets = [];
    const failed: { id: string; username: string; error: string }[] = [];

    // Sequential, not parallel: this is a mutating vendor call and a partial
    // failure should stop somewhere legible rather than fan out.
    for (const t of targets) {
      const r = await setPostStatus(t.id, nextStatus);
      if (r.ok) done.push(t);
      else failed.push({ id: t.id, username: t.username, error: r.error ?? "unknown" });
    }

    return NextResponse.json({
      ok: failed.length === 0,
      action,
      date: today,
      [action === "undo" ? "unqueued" : "queued"]: done,
      skipped,
      failed,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
