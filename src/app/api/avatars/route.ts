/**
 * List the 10 named avatar slots and their current reference image
 * URLs (or null when un-set). Same auth gate as the rest of the
 * admin endpoints. The dashboard's Image Studio loads this on mount
 * to render the avatar picker row above the reference-image field.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { listAvatars } from "@/lib/avatars-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  try {
    const avatars = await listAvatars();
    return NextResponse.json({ ok: true, avatars });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
