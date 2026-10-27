/**
 * Store Reviews tab (src/lib/store-reviews.ts).
 *
 * GET   — stored App Store + Google Play reviews, newest first, each with its
 *         attention verdict, plus per-store summaries.
 * POST  — sync both stores now (the daily cron does the same).
 * PATCH — { id, handled: boolean } marks a review handled or reopens it.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  STORE_LINKS,
  appStoreConfigured,
  attentionFor,
  listStoredReviews,
  playConfigured,
  setHandled,
  storeReviewsDbConfigured,
  summarizeStore,
  syncStoreReviews,
} from "@/lib/store-reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function guard(req: Request): NextResponse | null {
  if (!checkIngestAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!storeReviewsDbConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  }
  return null;
}

const fail = (e: unknown) =>
  NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });

export async function GET(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  try {
    const rows = await listStoredReviews();
    return NextResponse.json({
      ok: true,
      reviews: rows.map((r) => ({ ...r, attention: attentionFor(r) })),
      summary: [summarizeStore("app_store", rows), summarizeStore("google_play", rows)],
      configured: { app_store: appStoreConfigured(), google_play: playConfigured() },
      links: STORE_LINKS,
    });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  try {
    return NextResponse.json({ ok: true, results: await syncStoreReviews() });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  const body = (await req.json().catch(() => null)) as { id?: unknown; handled?: unknown } | null;
  if (!body || typeof body.id !== "string" || typeof body.handled !== "boolean") {
    return NextResponse.json({ ok: false, error: "expected { id, handled }" }, { status: 400 });
  }
  try {
    await setHandled(body.id, body.handled);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
