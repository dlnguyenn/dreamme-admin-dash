/**
 * List the named pose-reference slots and their current image URLs (or
 * null when un-set). Same auth gate as the rest of the admin endpoints.
 * The dashboard's Image Studio loads this on mount to render the pose
 * picker row. Mirrors /api/avatars.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { listPoses } from "@/lib/poses-server";

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
    const poses = await listPoses();
    return NextResponse.json({ ok: true, poses });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
