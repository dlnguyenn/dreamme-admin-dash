/**
 * Bulk-delete one or more image_generations rows (and their storage
 * blobs in the `mcp-image-generations` bucket). Same auth as the rest
 * of /api/image-studio/*. Accepts a single `ids: string[]` payload so
 * the gallery's multi-select flow can hit one endpoint regardless of
 * how many tiles are selected.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { deleteImageGenerations } from "@/lib/image-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
  try {
    const { deleted } = await deleteImageGenerations(parsed.ids);
    return NextResponse.json({ ok: true, deleted });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
