/**
 * Attribution overview — feeds the Attribution tab. Read-only aggregates
 * over attr_clicks / attr_installs / rc_events (all service-role-only
 * tables, so the gated UI reads through this route rather than anon
 * PostgREST). checkIngestAuth's same-origin path serves the dashboard;
 * the secret header works for tooling.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { fetchAttributionInputs } from "@/lib/attr-installs";
import { buildAttributionReport } from "@/lib/attr-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 30));
    const { clicks, installs, trials } = await fetchAttributionInputs(days);
    return NextResponse.json({ days, ...buildAttributionReport(clicks, installs, trials) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
