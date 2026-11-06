/**
 * GET /api/briefs/:slug — a brief's Markdown (src/lib/briefs/<slug>.md,
 * bundled by scripts/build-briefs.mjs). Shown by BriefReader on the Roadmap,
 * so a brief linked from a card opens behind the DAD password.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { BRIEFS } from "@/lib/briefs/generated";
import { markdownTitle } from "@/lib/mini-markdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { slug } = await params;
  const markdown = Object.prototype.hasOwnProperty.call(BRIEFS, slug) ? BRIEFS[slug] : null;
  if (!markdown) {
    return NextResponse.json({ ok: false, error: "brief not found" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    brief: { slug, title: markdownTitle(markdown) ?? slug, markdown },
  });
}
