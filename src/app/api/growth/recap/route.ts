/**
 * Weekly ad retro (Runneth's "Weekly Performance Recap").
 *
 * POST — generate a recap now, persist it to growth_recaps, return the row.
 * GET  — list the last 12 recaps (history picker in the Analyst view).
 *
 * The Monday cron lives at /api/cron/growth-recap and shares the same lib.
 */
import { NextResponse } from "next/server";
import { MODELS, isModelId } from "@/lib/models";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { generateWeeklyRecap, persistRecap, listRecaps } from "@/lib/growth-recap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const recaps = await listRecaps(12);
    return NextResponse.json({ recaps });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  let model: string = MODELS.SONNET_4_6;
  try {
    const raw = (await req.json().catch(() => ({}))) as { model?: string };
    if (raw.model && isModelId(raw.model)) model = raw.model;
  } catch {
    // default model
  }

  try {
    const generated = await generateWeeklyRecap(model);
    let row = generated;
    try {
      row = await persistRecap(generated, "manual");
    } catch {
      // persistence is best-effort — still return the generated recap
    }
    return NextResponse.json({
      ...row,
      // legacy shape the client cache expects
      generated_at: row.generated_at ?? new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
