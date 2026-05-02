import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sbHeaders(): Record<string, string> {
  return {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${SUPABASE_ANON}`,
    "Content-Type": "application/json",
  };
}

/**
 * GET → list of favorited video ids (so the UI can highlight which cards
 *       are saved).
 * POST { videoId, save: boolean, notes?: string } → toggle favorite.
 */
export async function GET() {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    return NextResponse.json({ ok: false, error: "Supabase not configured" }, { status: 500 });
  }
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/spy_favorites?select=video_id,saved_at,notes&order=saved_at.desc&limit=500`,
    { headers: sbHeaders(), cache: "no-store" },
  );
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `spy_favorites read: ${res.status} ${await res.text()}` },
      { status: 500 },
    );
  }
  const rows = await res.json();
  return NextResponse.json({ ok: true, rows });
}

export async function POST(req: Request) {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    return NextResponse.json({ ok: false, error: "Supabase not configured" }, { status: 500 });
  }
  let body: { videoId?: string; save?: boolean; notes?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  if (!body.videoId || typeof body.videoId !== "string") {
    return NextResponse.json({ ok: false, error: "videoId required" }, { status: 400 });
  }

  if (body.save) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/spy_favorites?on_conflict=video_id`,
      {
        method: "POST",
        headers: { ...sbHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          video_id: body.videoId,
          notes: body.notes ?? null,
        }),
      },
    );
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `favorite save: ${res.status} ${await res.text()}` },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, saved: true });
  } else {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/spy_favorites?video_id=eq.${body.videoId}`,
      {
        method: "DELETE",
        headers: { ...sbHeaders(), Prefer: "return=minimal" },
      },
    );
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `favorite remove: ${res.status} ${await res.text()}` },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, saved: false });
  }
}
