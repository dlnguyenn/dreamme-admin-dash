import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SpyRow {
  id: string;
  source_hashtag: string;
  source_type: "hashtag" | "search";
  view_count: number;
  category: string | null;
  first_slide_text: string | null;
  hook_normalized: string | null;
  posted_at: string | null;
  is_viral: boolean;
}

/**
 * Aggregated trends for the last 7 days. Pulls a slice of spy_videos
 * filtered to posted_at within window, then aggregates client-side
 * (Postgrest can't do GROUP BY without an RPC and the volume is small —
 * a few hundred rows max).
 */
export async function GET() {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    return NextResponse.json({ ok: false, error: "Supabase not configured" }, { status: 500 });
  }
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const url =
    `${SUPABASE_URL}/rest/v1/spy_videos?select=id,source_hashtag,source_type,view_count,category,first_slide_text,hook_normalized,posted_at,is_viral` +
    `&posted_at=gte.${cutoff}&limit=2000`;
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
  const rows = (await res.json()) as SpyRow[];

  // Top 10 hooks this week — by views, dedup by normalized hook
  const byNormalizedHook = new Map<string, { hook: string; views: number; postId: string }>();
  for (const r of rows) {
    const norm = (r.hook_normalized ?? "").trim();
    if (!norm) continue;
    const existing = byNormalizedHook.get(norm);
    if (!existing || existing.views < r.view_count) {
      byNormalizedHook.set(norm, {
        hook: r.first_slide_text ?? "",
        views: r.view_count,
        postId: r.id,
      });
    }
  }
  const topHooks = Array.from(byNormalizedHook.values())
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  // Category distribution
  const byCategory = new Map<string, { posts: number; views: number }>();
  for (const r of rows) {
    const cat = r.category ?? "other";
    const cur = byCategory.get(cat) ?? { posts: 0, views: 0 };
    cur.posts += 1;
    cur.views += r.view_count;
    byCategory.set(cat, cur);
  }
  const categories = Array.from(byCategory.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.views - a.views);

  // Top hashtags by surfaced views (only source_type='hashtag')
  const byHashtag = new Map<string, { posts: number; views: number; viralCount: number }>();
  // Top search queries by surfaced views (only source_type='search')
  const byQuery = new Map<string, { posts: number; views: number; viralCount: number }>();
  for (const r of rows) {
    const target = r.source_type === "search" ? byQuery : byHashtag;
    const cur = target.get(r.source_hashtag) ?? { posts: 0, views: 0, viralCount: 0 };
    cur.posts += 1;
    cur.views += r.view_count;
    if (r.is_viral) cur.viralCount += 1;
    target.set(r.source_hashtag, cur);
  }
  const hashtags = Array.from(byHashtag.entries())
    .map(([hashtag, v]) => ({ hashtag, ...v }))
    .sort((a, b) => b.views - a.views);
  const searchQueries = Array.from(byQuery.entries())
    .map(([query, v]) => ({ query, ...v }))
    .sort((a, b) => b.views - a.views);

  return NextResponse.json({
    ok: true,
    windowDays: 7,
    samples: rows.length,
    topHooks,
    categories,
    hashtags,
    searchQueries,
  });
}
