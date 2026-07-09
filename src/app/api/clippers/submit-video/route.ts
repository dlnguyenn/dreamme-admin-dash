/**
 * Public, token-scoped video submission — the small form on /clip/[token].
 * A clipper pastes their own video link; the daily cron picks up views.
 *
 * Auth = possession of the clipper's unguessable token (same trust model as
 * the page itself). Rate-limited by a per-clipper video cap.
 */
import { NextResponse } from "next/server";
import { clippersDbConfigured, sbGet, sbPost, type ClipperRow } from "@/lib/clippers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_VIDEOS_PER_CLIPPER = 300;

const ALLOWED_HOSTS = [
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "fb.watch",
  "tiktok.com",
  "www.tiktok.com",
  "instagram.com",
  "www.instagram.com",
];

function platformForHost(host: string): string {
  if (host.includes("tiktok")) return "tiktok";
  if (host.includes("instagram")) return "instagram";
  return "facebook";
}

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
  if (!ALLOWED_HOSTS.includes(parsed.host.toLowerCase())) {
    return NextResponse.json(
      { error: "link must be a Facebook, TikTok, or Instagram video" },
      { status: 400 },
    );
  }

  const clippers = await sbGet<ClipperRow[]>(
    `clippers?token=eq.${encodeURIComponent(token)}&active=eq.true&select=id&limit=1`,
  );
  const clipper = clippers[0];
  if (!clipper) {
    return NextResponse.json({ error: "unknown token" }, { status: 404 });
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
      [
        {
          clipper_id: clipper.id,
          url: parsed.toString(),
          platform: platformForHost(parsed.host.toLowerCase()),
          source: "clipper",
        },
      ],
      { onConflict: "url" },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
