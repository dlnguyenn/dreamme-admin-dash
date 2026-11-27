/**
 * PATCH /api/competitor-ads/hooks/:id { pick: "brief" | "maybe" | "skip" | null }
 * Sets the Pick column of one row in the hook database. Admin only.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminAuth } from "@/lib/auth-ingest";
import { supportDbConfigured } from "@/lib/support/db";
import { setHookPick } from "@/lib/competitor-ads-tab/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ pick: z.enum(["brief", "maybe", "skip"]).nullable() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!checkAdminAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supportDbConfigured()) return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  if (!/^[a-z0-9]+:[a-z0-9-]{1,100}$/.test(decoded)) return NextResponse.json({ ok: false, error: "bad hook id" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "pick must be brief, maybe, skip or null" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await setHookPick(decoded, parsed.data.pick)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
