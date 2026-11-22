/**
 * GET /api/competitor-ads/ad/:adArchiveId — what the ad drawer loads on open:
 * the archive transcript (timed where present), Outlier's storyboard and the
 * daily rank history. Admin only.
 */
import { NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/auth-ingest";
import { supportDbConfigured } from "@/lib/support/db";
import { getAdDetail } from "@/lib/competitor-ads-tab/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdminAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supportDbConfigured()) return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  const { id } = await params;
  if (!/^\d{5,25}$/.test(id)) return NextResponse.json({ ok: false, error: "bad ad id" }, { status: 400 });
  try {
    return NextResponse.json(await getAdDetail(id));
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
