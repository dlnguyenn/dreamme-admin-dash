import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";
import { assignDailyHooks } from "@/lib/daily-hooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!checkCronAuth(req))
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const origin = new URL(req.url).origin;
  const secret = process.env.CRON_SECRET ?? "";
  const res = await fetch(`${origin}/api/generate/hooks`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dreamme-secret": secret,
    },
    body: JSON.stringify({ perPersona: 3 }),
  });
  const json = await res.json();
  if (!res.ok) {
    return NextResponse.json({ ok: false, inner: json }, { status: 500 });
  }

  let assignment: unknown = null;
  let assignmentError: string | null = null;
  try {
    assignment = await assignDailyHooks();
  } catch (e) {
    assignmentError = (e as Error).message;
    console.error("[cron/generate] assignDailyHooks failed", e);
  }

  return NextResponse.json({
    ok: true,
    inner: json,
    assignment,
    assignmentError,
  });
}
