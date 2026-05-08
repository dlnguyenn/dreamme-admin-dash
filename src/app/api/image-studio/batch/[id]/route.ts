/**
 * Lazy poller for a single image-generation batch. Calling this
 * endpoint triggers `getImageBatch`, which queries Gemini if the local
 * status is non-terminal — and on `SUCCEEDED` downloads outputs,
 * uploads them to the bucket, and inserts `image_generations` rows.
 *
 * The Image Studio UI calls this on a 30 s interval for any batch
 * whose status is still PENDING or RUNNING.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { getImageBatch } from "@/lib/image-generation-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "batch id missing" },
      { status: 400 },
    );
  }
  try {
    const batch = await getImageBatch({ batchId: id });
    return NextResponse.json({ ok: true, batch });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
