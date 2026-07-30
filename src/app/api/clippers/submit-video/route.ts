/**
 * Public, token-scoped video submission — the small form on /clip/[token].
 * A clipper pastes their own video link; the daily cron picks up views.
 *
 * Auth = possession of the clipper's unguessable token (same trust model as
 * the page itself). Rate-limited by a per-clipper video cap.
 */
import { NextResponse } from "next/server";
import { clippersDbConfigured, sbGet, sbPost, type ClipperRow } from "@/lib/clippers";
import { normalizeFacebookUrl } from "@/lib/facebookViews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_VIDEOS_PER_CLIPPER = 300;

// Facebook only: it's the only platform we scrape views for. Accepting TikTok
// or Instagram links here used to create rows that sat at 0 views forever with
// no explanation, which reads as "my video flopped" rather than "not tracked".
const ALLOWED_HOSTS = [
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "web.facebook.com",
  "mbasic.facebook.com",
  "fb.watch",
];

const OTHER_PLATFORM_HOSTS = ["tiktok", "instagram", "youtube", "youtu.be"];

export async function POST(req: Request) {
  if (!clippersDbConfigured()) {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  let body: { token?: string; url?: string };
  try {
    body = (await req.json()) as { token?: string; url?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const token = body.token?.trim() ?? "";
  const rawUrl = body.url?.trim() ?? "";
  if (!token || !rawUrl) {
    return NextResponse.json({ error: "token and url required" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  const host = parsed.host.toLowerCase();
  if (!ALLOWED_HOSTS.includes(host)) {
    const other = OTHER_PLATFORM_HOSTS.find((p) => host.includes(p));
    return NextResponse.json(
      {
        error: other
          ? "We only track Facebook views right now — paste a Facebook video or reel link"
          : "link must be a Facebook video or reel",
      },
      { status: 400 },
    );
  }
  // Canonical form: the daily refresh matches scraper output to rows by exact
  // URL string, and clipper_videos.url is globally unique.
  const url = normalizeFacebookUrl(parsed.toString());

  const clippers = await sbGet<ClipperRow[]>(
    `clippers?token=eq.${encodeURIComponent(token)}&active=eq.true&select=id&limit=1`,
  );
  const clipper = clippers[0];
  if (!clipper) {
    return NextResponse.json({ error: "unknown token" }, { status: 404 });
  }

  // url is globally unique, so a plain upsert would silently reassign a video
  // that already belongs to someone else.
  const existing = await sbGet<{ id: string; clipper_id: string }[]>(
    `clipper_videos?url=eq.${encodeURIComponent(url)}&select=id,clipper_id&limit=1`,
  );
  if (existing[0] && existing[0].clipper_id !== clipper.id) {
    return NextResponse.json(
      { error: "That video is already tracked by another creator" },
      { status: 409 },
    );
  }
  if (existing[0]) {
    return NextResponse.json({ ok: true, alreadyTracked: true });
  }

  const count = await sbGet<{ id: string }[]>(
    `clipper_videos?clipper_id=eq.${clipper.id}&select=id&limit=${MAX_VIDEOS_PER_CLIPPER}`,
  );
  if (count.length >= MAX_VIDEOS_PER_CLIPPER) {
    return NextResponse.json({ error: "video limit reached" }, { status: 429 });
  }

  try {
    await sbPost(
      "clipper_videos",
      [{ clipper_id: clipper.id, url, platform: "facebook", source: "clipper" }],
      { onConflict: "url" },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
