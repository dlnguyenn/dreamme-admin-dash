/**
 * Deep Research runs — create + list. The heavy lifting happens in
 * /api/growth/research/step, which the client calls in a loop.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  createResearchRun,
  listResearchRuns,
  getResearchRun,
  runProgress,
} from "@/lib/growth-research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  question: z.string().min(10).max(500),
});

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "invalid body" },
      { status: 400 },
    );
  }
  try {
    const run = await createResearchRun(body.question);
    return NextResponse.json({ run, progress: runProgress(run) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  try {
    if (id) {
      const run = await getResearchRun(id);
      if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ run, progress: runProgress(run) });
    }
    const limit = Number(url.searchParams.get("limit")) || 12;
    const runs = await listResearchRuns(limit);
    return NextResponse.json({
      runs: runs.map((r) => ({ ...r, progress: runProgress(r) })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
