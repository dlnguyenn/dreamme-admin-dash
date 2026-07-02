/**
 * Monday-morning weekly recap cron (Runneth's recap-in-your-inbox):
 * generate → persist to growth_recaps → email via the n8n webhook
 * (skips delivery with a note when N8N_GROWTH_RECAP_WEBHOOK_URL is unset).
 */
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { generateWeeklyRecap, persistRecap, sendRecapEmail } from "@/lib/growth-recap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }
  try {
    const generated = await generateWeeklyRecap();
    const row = await persistRecap(generated, "cron");
    const delivery = await sendRecapEmail(row);
    return NextResponse.json({
      ok: true,
      week_start: row.week_start,
      recap_id: row.id ?? null,
      sent: delivery.sent,
      ...(delivery.note ? { note: delivery.note } : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
