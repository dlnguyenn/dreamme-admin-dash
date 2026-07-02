/**
 * On-demand creative tagging (Motion-style AI tags). Tags a batch of
 * untagged/stale ads; the UI's "Re-tag" button passes ad_ids + force.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { tagBatch } from "@/lib/growth-tagging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  limit: z.number().int().min(1).max(25).optional(),
  force: z.boolean().optional(),
  ad_ids: z.array(z.string()).max(25).optional(),
  model: z.string().optional(),
});

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json().catch(() => ({})));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid body" },
      { status: 400 },
    );
  }
  try {
    const result = await tagBatch({
      limit: body.limit,
      force: body.force,
      adIds: body.ad_ids,
      model: body.model,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
