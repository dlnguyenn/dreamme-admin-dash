import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { recomputeFatigue, createPostgrestFamilyStore } from "@/lib/families";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!checkCronAuth(req))
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !(process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY)
  ) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }
  try {
    const summary = await recomputeFatigue(createPostgrestFamilyStore());
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
