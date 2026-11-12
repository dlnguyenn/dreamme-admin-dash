import { NextResponse } from "next/server";
import { SESSION_COOKIE, clearCookie, isHttps } from "@/lib/dad-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST only, so a link or image on another site can't sign anyone out. */
export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", clearCookie(SESSION_COOKIE, isHttps(req)));
  res.headers.set("Cache-Control", "no-store");
  return res;
}
