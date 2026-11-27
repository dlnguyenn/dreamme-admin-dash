/**
 * The Competitor ads swipe file.
 * POST   /api/competitor-ads/saves { adArchiveId, pageId, note? } — save (or update the note)
 * DELETE /api/competitor-ads/saves?id=<adArchiveId>             — remove
 * Admin only.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminAuth, requestAccount } from "@/lib/auth-ingest";
import { supportDbConfigured } from "@/lib/support/db";
import { saveAd, unsaveAd } from "@/lib/competitor-ads-tab/read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  adArchiveId: z.string().regex(/^\d{5,25}$/),
  pageId: z.string().regex(/^\d{5,25}$/),
  note: z.string().max(2000).optional(),
});

function guard(req: Request): NextResponse | null {
  if (!checkAdminAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supportDbConfigured()) return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  return null;
}

const fail = (e: unknown) => NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });

export async function POST(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "adArchiveId and pageId are required" }, { status: 400 });
  try {
    const who = requestAccount(req)?.name ?? "script";
    return NextResponse.json({ ok: true, ...(await saveAd(parsed.data.adArchiveId, parsed.data.pageId, parsed.data.note ?? "", who)) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^\d{5,25}$/.test(id)) return NextResponse.json({ ok: false, error: "bad ad id" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, ...(await unsaveAd(id)) });
  } catch (e) {
    return fail(e);
  }
}
