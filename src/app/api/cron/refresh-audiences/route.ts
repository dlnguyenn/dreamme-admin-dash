import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { audiencesConfigured, runAudienceSync } from "@/lib/audiences";
import { audienceSourceConfigured } from "@/lib/audience-subscribers";
import { revenueCatConfigured } from "@/lib/vendors/revenuecat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Closed-loop RC→Meta audience sync (Module 4). Weekly via vercel.json.
// Pipeline: snapshot live subscribers → derive lapsed by diff → build/refresh
// suppression + high-LTV lookalike + win-back audiences → exclude suppression
// from auto-discovered active prospecting ad sets. See src/lib/audiences.ts.
//
// Pass ?dry_run=1 to write nothing at all (snapshot/registry reads + read-only Meta
// discovery still run) — safe to point at production.
export async function GET(req: Request) {
  if (!checkCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!audiencesConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured" },
      { status: 500 },
    );
  }
  if (!audienceSourceConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Consumer Supabase env not configured" },
      { status: 500 },
    );
  }
  if (!revenueCatConfigured()) {
    return NextResponse.json(
      { ok: false, error: "RevenueCat env not configured" },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  try {
    const result = await runAudienceSync({ dryRun });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
