import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { apifyConfigured, runTikTokPostScrape } from "@/lib/apify";
import { ApifyTikTokItemSchema } from "@/lib/schemas/apify";
import { fetchToStorage, storageConfigured } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

function sbHeaders() {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

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
    // Dedup: if we've already collected this URL, short-circuit with 409.
    const existing = await fetch(
      `${SUPABASE_URL}/rest/v1/viral_slideshows?select=id&tiktok_url=eq.${encodeURIComponent(tiktokUrl)}&limit=1`,
      { headers: sbHeaders(), cache: "no-store" },
    );
    if (existing.ok) {
      const rows = (await existing.json()) as Array<{ id: string }>;
      if (rows.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "This slideshow is already in your collection.",
            id: rows[0].id,
          },
          { status: 409 },
        );
      }
    }

    // Scrape the post. The actor returns an array; we expect exactly one
    // item for a single-URL call.
    const rawItems = await runTikTokPostScrape({ postUrls: [tiktokUrl] });
    if (!rawItems.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Scraper returned no items. Check the URL is a public TikTok post.",
        },
        { status: 400 },
      );
    }
    const parsedItem = ApifyTikTokItemSchema.safeParse(rawItems[0]);
    if (!parsedItem.success) {
      return NextResponse.json(
        { ok: false, error: "Scraper response did not match expected shape" },
        { status: 502 },
      );
    }
    const item = parsedItem.data;
    const slideLinks = item.slideshowImageLinks ?? [];
    if (!item.isSlideshow || slideLinks.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only TikTok slideshow (photo) posts are supported. This URL looks like a single video.",
        },
        { status: 400 },
      );
    }

    // Generate an ID up-front so we can namespace the storage paths under
    // `viral-slideshows/{id}/...` before inserting the row.
    const id = crypto.randomUUID();
    const shortId = id.slice(0, 8);
    const slides: Array<{ image_url: string }> = [];
    for (let i = 0; i < slideLinks.length; i++) {
      const src =
        slideLinks[i].downloadLink ?? slideLinks[i].tiktokLink ?? null;
      if (!src) {
        throw new Error(`Slide ${i} missing download URL from Apify`);
      }
      const path = `viral-slideshows/${id}/slide-${String(i).padStart(2, "0")}-${shortId}.jpg`;
      const imageUrl = await fetchToStorage(src, path);
      slides.push({ image_url: imageUrl });
    }

    const caption = (item.text ?? "").trim();
    const authorUsername = item.authorMeta?.name ?? null;
    const postCreatedAt = item.createTimeISO ?? null;

    const insert = await fetch(`${SUPABASE_URL}/rest/v1/viral_slideshows`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "return=representation" },
      body: JSON.stringify({
        id,
        tiktok_url: tiktokUrl,
        author_username: authorUsername,
        caption,
        play_count: item.playCount ?? null,
        digg_count: item.diggCount ?? null,
        comment_count: item.commentCount ?? null,
        share_count: item.shareCount ?? null,
        post_created_at: postCreatedAt,
        slide_count: slides.length,
        slides,
      }),
    });
    if (!insert.ok) {
      throw new Error(
        `viral_slideshow insert failed: ${insert.status} ${await insert.text()}`,
      );
    }
    const rows = await insert.json();
    const slideshow = Array.isArray(rows) ? rows[0] : rows;
    return NextResponse.json({ ok: true, slideshow });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
