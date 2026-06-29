/**
 * Meta connection status + disconnect for the dashboard Integrations panel.
 * Admin-gated (shared admin password, v1 single-tenant). Never returns the
 * stored access token — only non-sensitive connection metadata.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_PASSWORD, safeStringEq } from "@/lib/mcp-oauth";
import { getConnectionPublic, disconnectAll } from "@/lib/meta-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authed(req: NextRequest): boolean {
  const url = new URL(req.url);
  const admin =
    req.headers.get("x-admin-password") ??
    url.searchParams.get("admin") ??
    "";
  return !!admin && safeStringEq(admin, ADMIN_PASSWORD);
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getConnectionPublic());
}

export async function DELETE(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await disconnectAll();
  return NextResponse.json({ ok: true });
}
