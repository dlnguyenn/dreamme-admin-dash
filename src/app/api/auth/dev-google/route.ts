/**
 * LOCALHOST ONLY: a stand-in for Google's account picker, so sign-in can be
 * tested end to end (allowed, refused, admin vs viewer) without a Google
 * client. Needs `next dev`, a loopback host and DAD_DEV_FAKE_GOOGLE=1;
 * anywhere else it is a 404. The callback accepts its "dev:" codes under the
 * same conditions, and NODE_ENV is inlined at build time, so on Vercel both
 * branches are dead code.
 */
import { NextResponse } from "next/server";
import { devFakeGoogleActive } from "@/lib/dad-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function GET(req: Request) {
  if (!devFakeGoogleActive(req)) return new NextResponse("Not found", { status: 404 });
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";
  const email = url.searchParams.get("email");
  if (email) {
    const code = "dev:" + Buffer.from(JSON.stringify({ email, nonce }), "utf8").toString("base64url");
    const q = new URLSearchParams({ code, state });
    return NextResponse.redirect(`${url.origin}/api/auth/google/callback?${q}`, 303);
  }
  const html = `<!doctype html><meta charset="utf-8"><title>Dev Google stand-in</title>
<body style="font:15px system-ui;max-width:420px;margin:12vh auto;padding:0 16px">
<p style="color:#b4552f;font:600 11px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase">Localhost stand-in for Google</p>
<h1 style="font-weight:500">Pick an account</h1>
<form method="get">
<input type="hidden" name="state" value="${esc(state)}"><input type="hidden" name="nonce" value="${esc(nonce)}">
<input name="email" type="email" required placeholder="someone@example.test" style="width:100%;padding:10px;font:inherit;box-sizing:border-box">
<button style="margin-top:12px;padding:10px 16px;font:inherit">Continue</button>
</form></body>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
