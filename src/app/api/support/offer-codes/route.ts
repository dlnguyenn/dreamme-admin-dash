/**
 * GET   /api/support/offer-codes — every one-time App Store offer code with
 *       counts, for the Support Inbox "Offer codes" sub tab.
 * PATCH /api/support/offer-codes — {code, used, note?}: mark a code used or
 *       free by hand (e.g. one sent from Gmail outside the dash).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  listOfferCodes,
  setOfferCodeUsed,
  supportDbConfigured,
} from "@/lib/support/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Patch = z.object({
  code: z.string().min(1).max(64),
  used: z.boolean(),
  note: z.string().max(500).nullable().optional(),
});

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) return fail("unauthorized", 401);
  if (!supportDbConfigured()) return fail("Supabase not configured", 500);
  try {
    const codes = await listOfferCodes();
    const used = codes.filter((c) => c.used_at).length;
    return NextResponse.json({
      ok: true,
      codes,
      counts: { total: codes.length, used, free: codes.length - used },
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
}

export async function PATCH(req: Request) {
  if (!checkIngestAuth(req)) return fail("unauthorized", 401);
  if (!supportDbConfigured()) return fail("Supabase not configured", 500);
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid JSON", 400);
  }
  const parsed = Patch.safeParse(raw);
  if (!parsed.success) return fail("invalid payload", 400);
  try {
    const row = await setOfferCodeUsed(parsed.data.code, parsed.data.used, parsed.data.note);
    if (!row) return fail("not found", 404);
    return NextResponse.json({ ok: true, code: row });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
}
