import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { apifyConfigured } from "@/lib/apify";
import { scConfigured } from "@/lib/scrapecreators-tiktok";
import { storageConfigured } from "@/lib/storage";
import {
  collectSlideshowFromUrl,
  detectPlatform,
  sbHeaders,
} from "@/lib/viral-slideshows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const CreateBody = z
  .object({
    // `url` is the platform-neutral field; `tiktokUrl` kept for back-compat.
    url: z.string().url().max(500).optional(),
    tiktokUrl: z.string().url().max(500).optional(),
  })
  .refine((b) => b.url || b.tiktokUrl, { message: "url is required" });

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/viral_slideshows?select=*&order=created_at.desc`,
      { headers: sbHeaders(), cache: "no-store" },
    );
    if (!res.ok) {
      throw new Error(
        `viral_slideshows read failed: ${res.status} ${await res.text()}`,
      );
    }
    const slideshows = await res.json();
    return NextResponse.json({ ok: true, slideshows });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
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
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    );
  }
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const postUrl = (parsed.data.url ?? parsed.data.tiktokUrl)!;
  const platform = detectPlatform(postUrl);

  // Instagram needs ScrapeCreators; TikTok needs SC or Apify.
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

  try {
    const result = await collectSlideshowFromUrl(postUrl);
    if (result.status === "duplicate") {
      return NextResponse.json(
        { ok: false, error: "This post is already in your collection." },
        { status: 409 },
      );
    }
    if (result.status === "not_slideshow") {
      return NextResponse.json(
        {
          ok: false,
          error:
            platform === "instagram"
              ? "Only Instagram carousel (multi-image) posts are supported. This looks like a single image or reel."
              : "Only TikTok slideshow (photo) posts are supported. This URL looks like a single video.",
        },
        { status: 400 },
      );
    }
    if (result.status === "error") {
      return NextResponse.json(
        { ok: false, error: result.error ?? "Scrape failed" },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, slideshow: result.slideshow });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
