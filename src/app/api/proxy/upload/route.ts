/**
 * Generic byte-relay proxy: GET source_url, PUT to upload_url.
 *
 * The Doublespeed sandbox blocks egress to Supabase Storage and Azure
 * Blob SAS hosts, so a sibling Claude session can't directly do
 * `prepare_media_upload` -> fetch -> PUT. This admin-dash already runs
 * unsandboxed on Vercel and proxies third-party calls (Gemini), so we
 * relay the bytes here.
 *
 * Same auth/contract as the `proxy_upload` MCP tool — both share the
 * `proxyUpload` helper in `src/lib/proxy-upload.ts`.
 */
import { NextResponse } from "next/server";
import { validateBearer } from "@/lib/mcp-oauth";
import { parseProxyUploadArgs, proxyUpload } from "@/lib/proxy-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function unauthorized(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );
}

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match || !(await validateBearer(match[1]))) return unauthorized();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json body" },
      { status: 400 },
    );
  }

  const parsed = parseProxyUploadArgs(raw);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400 },
    );
  }

  const result = await proxyUpload(parsed.args);
  if (result.ok) {
    return NextResponse.json({
      ok: true,
      bytes: result.bytes,
      status: result.status,
    });
  }
  // Map helper category -> HTTP status. Input errors (host allowlist,
  // missing fields) -> 400; upstream failures -> 502.
  const httpStatus = result.category === "input" ? 400 : 502;
  return NextResponse.json(
    {
      ok: false,
      error: result.error,
      ...(result.status !== undefined ? { status: result.status } : {}),
      ...(result.body !== undefined ? { body: result.body } : {}),
    },
    { status: httpStatus },
  );
}
