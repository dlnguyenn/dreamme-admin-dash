import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Spy videos list with filters. Read-only; uses anon key, gated only by
 * the dashboard's own session (admin-only nav entry).
 *
 * Query params:
 *   hashtag       optional, filter by source_hashtag
 *   category      optional, filter by category
 *   viral_only    "true" to only show is_viral=true
 *   sort          "views" (default) | "recent" (posted_at desc)
 *   limit         default 50, max 200
 *   offset        default 0
 */
export async function GET(req: Request) {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    return NextResponse.json({ ok: false, error: "Supabase not configured" }, { status: 500 });
  }
  const u = new URL(req.url);
  const hashtag = u.searchParams.get("hashtag");
  const category = u.searchParams.get("category");
  const viralOnly = u.searchParams.get("viral_only") === "true";
  const sourceTypeRaw = u.searchParams.get("source_type");
  const sourceType =
    sourceTypeRaw === "hashtag" || sourceTypeRaw === "search" ? sourceTypeRaw : null;
  const sort = u.searchParams.get("sort") === "recent" ? "recent" : "views";
  const limit = Math.min(
    Math.max(parseInt(u.searchParams.get("limit") ?? "50", 10) || 50, 1),
    200,
  );
  const offset = Math.max(parseInt(u.searchParams.get("offset") ?? "0", 10) || 0, 0);

  const filters: string[] = [];
  if (hashtag) filters.push(`source_hashtag=eq.${encodeURIComponent(hashtag)}`);
  if (sourceType) filters.push(`source_type=eq.${sourceType}`);
  if (category) filters.push(`category=eq.${encodeURIComponent(category)}`);
  if (viralOnly) filters.push("is_viral=eq.true");
  const order = sort === "recent" ? "posted_at.desc.nullslast" : "view_count.desc";

  const url =
    `${SUPABASE_URL}/rest/v1/spy_videos?select=*` +
    `&order=${order}` +
    `&limit=${limit}&offset=${offset}` +
    (filters.length ? `&${filters.join("&")}` : "");

  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `spy_videos read: ${res.status} ${await res.text()}` },
      { status: 500 },
    );
  }
  const rows = await res.json();
  return NextResponse.json({ ok: true, rows, limit, offset });
}
