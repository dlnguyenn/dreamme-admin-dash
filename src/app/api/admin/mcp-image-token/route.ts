/**
 * Returns the MCP image bearer token for the Image Studio connector-config
 * card. Gated by `checkIngestAuth` (which permits same-origin calls from
 * the password-gated dash UI). The token is never exposed to the browser
 * outside this endpoint.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.MCP_IMAGE_BEARER_TOKEN ?? "";
  const origin = new URL(req.url).origin;
  return NextResponse.json({
    ok: true,
    token: token || null,
    url: `${origin}/api/mcp/image`,
    configured: !!token,
  });
}
