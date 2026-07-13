import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { apifyConfigured } from "@/lib/apify";
import { storageConfigured } from "@/lib/storage";
import { collectSlideshowFromUrl, sbHeaders } from "@/lib/viral-slideshows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const CreateBody = z.object({
  tiktokUrl: z.string().url().max(500),
});

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
  if (!apifyConfigured()) {
    return NextResponse.json(
      { ok: false, error: "APIFY_KEY not set" },
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
  const tiktokUrl = parsed.data.tiktokUrl;

  try {
    const result = await collectSlideshowFromUrl(tiktokUrl);
    if (result.status === "duplicate") {
      return NextResponse.json(
        { ok: false, error: "This slideshow is already in your collection." },
        { status: 409 },
      );
    }
    if (result.status === "not_slideshow") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only TikTok slideshow (photo) posts are supported. This URL looks like a single video.",
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
