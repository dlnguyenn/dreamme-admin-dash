/**
 * Public, token-scoped Facebook page connect — the card on /clip/[token].
 *
 * A clipper pastes their page link; we validate it's a page (not a single
 * post), save it, and immediately scan it so their videos show up within
 * seconds instead of waiting for the 09:00 UTC cron.
 *
 * Auth = possession of the clipper's unguessable token, same trust model as
 * submit-video/route.ts and the page itself.
 */
import { NextResponse } from "next/server";
import { clippersDbConfigured, sbGet, sbPatch, type ClipperRow } from "@/lib/clippers";
import { normalizeFacebookPageUrl, fbViewsConfigured } from "@/lib/facebookViews";
import { syncClipperPage } from "@/lib/clipperSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Bounded so a first connect stays fast; the daily cron goes deeper. */
const CONNECT_SCAN_PAGES = 3;

export async function POST(req: Request) {
  if (!clippersDbConfigured()) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  let body: { token?: string; pageUrl?: string };
  try {
    body = (await req.json()) as { token?: string; pageUrl?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const token = body.token?.trim() ?? "";
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const check = normalizeFacebookPageUrl(body.pageUrl ?? "");
  if (!check.ok || !check.url) {
    return NextResponse.json({ error: check.error ?? "invalid page url" }, { status: 400 });
  }
  const pageUrl = check.url;

  const clippers = await sbGet<ClipperRow[]>(
    `clippers?token=eq.${encodeURIComponent(token)}&active=eq.true&select=id,code,facebook_page_url&limit=1`,
  );
  const clipper = clippers[0];
  if (!clipper) return NextResponse.json({ error: "unknown token" }, { status: 404 });

  // One page belongs to one creator — otherwise two clippers would both claim
  // the same videos (clipper_videos.url is globally unique, so the second one
  // would silently steal them).
  const taken = await sbGet<{ id: string }[]>(
    `clippers?facebook_page_url=eq.${encodeURIComponent(pageUrl)}&select=id&limit=2`,
  );
  if (taken.some((c) => c.id !== clipper.id)) {
    return NextResponse.json(
      { error: "That page is already connected to another creator. Contact us if that's wrong." },
      { status: 409 },
    );
  }

  try {
    await sbPatch(`clippers?id=eq.${clipper.id}`, {
      facebook_page_url: pageUrl,
      page_connected_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // Scan now for instant feedback. A scan failure must NOT lose the connection
  // the clipper just made — the daily cron will retry.
  let discovered = 0;
  let scanError: string | undefined;
  if (fbViewsConfigured()) {
    try {
      const res = await syncClipperPage(
        clipper.id,
        pageUrl,
        clipper.code,
        CONNECT_SCAN_PAGES,
      );
      discovered = res.discovered;
      if (res.errors.length) scanError = res.errors[0];
    } catch (e) {
      scanError = (e as Error).message.slice(0, 200);
    }
  } else {
    scanError = "scraping not configured";
  }

  return NextResponse.json({ ok: true, pageUrl, discovered, ...(scanError ? { scanError } : {}) });
}
