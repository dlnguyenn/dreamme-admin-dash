import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { apifyConfigured } from "@/lib/apify";
import { scrapeTopComments, sbHeaders } from "@/lib/viral-slideshows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const Body = z.object({ id: z.string().uuid() });

// (Re)fetch the top comments for one already-collected slideshow. Used to
// backfill rows saved before comments existed and to refresh stale threads.
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
  if (!apifyConfigured()) {
    return NextResponse.json({ ok: false, error: "APIFY_KEY not set" }, { status: 500 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  }

  try {
    const lookup = await fetch(
      `${SUPABASE_URL}/rest/v1/viral_slideshows?select=id,tiktok_url&id=eq.${parsed.data.id}&limit=1`,
      { headers: sbHeaders(), cache: "no-store" },
    );
    if (!lookup.ok) throw new Error(`lookup failed: ${lookup.status}`);
    const rows = (await lookup.json()) as Array<{ id: string; tiktok_url: string }>;
    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const comments = await scrapeTopComments(rows[0].tiktok_url);

    const upd = await fetch(
      `${SUPABASE_URL}/rest/v1/viral_slideshows?id=eq.${parsed.data.id}`,
      {
        method: "PATCH",
        headers: { ...sbHeaders(), Prefer: "return=representation" },
        body: JSON.stringify({ comments }),
      },
    );
    if (!upd.ok) {
      throw new Error(`update failed: ${upd.status} ${await upd.text()}`);
    }
    const updated = await upd.json();
    const slideshow = Array.isArray(updated) ? updated[0] : updated;
    return NextResponse.json({ ok: true, slideshow, count: comments.length });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
