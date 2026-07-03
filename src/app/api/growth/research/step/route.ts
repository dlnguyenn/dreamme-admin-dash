/**
 * Advance a Deep Research run by one bounded phase chunk. The client
 * (ResearchRail) calls this in a loop until status is done/failed —
 * that's how a 5-10 minute research run fits inside serverless limits,
 * and why any run is resumable from exactly where it stopped.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { stepResearchRun, runProgress } from "@/lib/growth-research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  run_id: z.string().uuid(),
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
    const run = await stepResearchRun(body.run_id);
    return NextResponse.json({ run, progress: runProgress(run) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
