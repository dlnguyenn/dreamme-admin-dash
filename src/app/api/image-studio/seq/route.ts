/**
 * 1-based sequence number of a generation within its (avatar, pose)
 * group, ordered by created_at. The Image Studio uses this to build the
 * `avatar_pose_###` download filename. Same-origin / bearer-token gated
 * like the rest of the admin endpoints.
 *
 * Query params:
 *   avatar  (required) — avatar slug, e.g. "ava"
 *   pose    (optional) — pose slug, e.g. "car-selfie"; omit for avatar-only
 *   before  (required) — the row's created_at ISO timestamp
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { avatarPoseSequence } from "@/lib/image-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const avatar = url.searchParams.get("avatar");
  const pose = url.searchParams.get("pose");
  const before = url.searchParams.get("before");
  if (!avatar || !before) {
    return NextResponse.json(
      { ok: false, error: "avatar and before are required" },
      { status: 400 },
    );
  }
  try {
    const seq = await avatarPoseSequence({
      avatar,
      pose: pose && pose.length > 0 ? pose : null,
      beforeIso: before,
    });
    return NextResponse.json({ ok: true, seq });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
