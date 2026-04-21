import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/auth-ingest";

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
    body: JSON.stringify({ perPersona: 2 }),
  });
  const json = await res.json();
  return NextResponse.json({ ok: res.ok, inner: json }, { status: res.ok ? 200 : 500 });
}
