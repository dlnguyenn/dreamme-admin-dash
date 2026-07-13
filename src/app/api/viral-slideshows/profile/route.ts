import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { apifyConfigured } from "@/lib/apify";
import { scConfigured } from "@/lib/scrapecreators-tiktok";
import { storageConfigured } from "@/lib/storage";
import {
  collectTopSlideshowsFromProfile,
  normalizeProfile,
} from "@/lib/viral-slideshows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const Body = z.object({
  profile: z.string().min(1).max(200),
  platform: z.enum(["tiktok", "instagram"]).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }
  if (!storageConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Storage not configured" },
      { status: 500 },
    );
  }

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

  const platform = parsed.data.platform ?? "tiktok";
  if (platform === "instagram" && !scConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Instagram requires a ScrapeCreators API key." },
      { status: 500 },
    );
  }
  if (platform === "tiktok" && !scConfigured() && !apifyConfigured()) {
    return NextResponse.json(
      { ok: false, error: "No TikTok scraper configured (ScrapeCreators or Apify)." },
      { status: 500 },
    );
  }

  const profile = normalizeProfile(parsed.data.profile);
  if (!profile) {
    return NextResponse.json(
      { ok: false, error: "Could not read a username from that input." },
      { status: 400 },
    );
  }

  try {
    const summary = await collectTopSlideshowsFromProfile(
      profile,
      parsed.data.limit ?? 10,
      platform,
    );
    if (summary.considered === 0) {
      const kind = platform === "instagram" ? "carousel" : "slideshow (photo)";
      return NextResponse.json(
        {
          ok: false,
          error: `No ${kind} posts found for @${profile} in their recent posts.`,
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, platform, ...summary });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
