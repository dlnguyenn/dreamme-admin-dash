/**
 * Paginated list of recent image generations for the Image Studio gallery,
 * newest first. Same-origin / bearer-token gated like the rest of the
 * admin endpoints.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { listImageGenerations } from "@/lib/image-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 24);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  try {
    const rows = await listImageGenerations({
      limit: Number.isFinite(limit) ? limit : 24,
      offset: Number.isFinite(offset) ? offset : 0,
    });
    return NextResponse.json({ ok: true, rows });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
