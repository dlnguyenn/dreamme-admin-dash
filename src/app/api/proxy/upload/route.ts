/**
 * Generic byte-relay proxy: GET source_url, PUT to upload_url.
 *
 * The Doublespeed sandbox blocks egress to Supabase Storage and Azure
 * Blob SAS hosts, so a sibling Claude session can't directly do
 * `prepare_media_upload` → fetch → PUT. This admin-dash already runs
 * unsandboxed on Vercel and proxies third-party calls (Gemini), so we
 * relay the bytes here.
 *
 * The endpoint is intentionally generic — it has zero knowledge of
 * Doublespeed, Supabase, or any product. Both URLs and the PUT
 * headers are provided by the caller.
 *
 * Security:
 *   - Bearer auth via `validateBearer` (same scheme as /api/mcp/image).
 *   - source_url host must end with `.supabase.co` or `.blob.core.windows.net`.
 *   - upload_url host must end with `.blob.core.windows.net`.
 *   - No retries, no buffering tricks — pass the source body straight
 *     into the upload fetch.
 */
import { NextResponse } from "next/server";
import { validateBearer } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ALLOWED_SOURCE_SUFFIXES = [".supabase.co", ".blob.core.windows.net"];
const ALLOWED_UPLOAD_SUFFIXES = [".blob.core.windows.net"];

interface RelayBody {
  source_url?: unknown;
  upload_url?: unknown;
  source_headers?: unknown;
  upload_headers?: unknown;
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (typeof val !== "string") return false;
  }
  return true;
}

function hostAllowed(urlStr: string, suffixes: string[]): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase();
  for (const s of suffixes) {
    if (host === s.replace(/^\./, "") || host.endsWith(s)) return parsed;
  }
  return null;
}

async function readTruncated(res: Response, max = 500): Promise<string> {
  try {
    const text = await res.text();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return "";
  }
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    },
  );
}

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match || !(await validateBearer(match[1]))) return unauthorized();

  let body: RelayBody;
  try {
    body = (await req.json()) as RelayBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json body" },
      { status: 400 },
    );
  }

  if (typeof body.source_url !== "string" || !body.source_url) {
    return NextResponse.json(
      { ok: false, error: "source_url is required" },
      { status: 400 },
    );
  }
  if (typeof body.upload_url !== "string" || !body.upload_url) {
    return NextResponse.json(
      { ok: false, error: "upload_url is required" },
      { status: 400 },
    );
  }
  if (body.source_headers !== undefined && !isStringRecord(body.source_headers)) {
    return NextResponse.json(
      { ok: false, error: "source_headers must be an object of strings" },
      { status: 400 },
    );
  }
  if (body.upload_headers !== undefined && !isStringRecord(body.upload_headers)) {
    return NextResponse.json(
      { ok: false, error: "upload_headers must be an object of strings" },
      { status: 400 },
    );
  }

  const source = hostAllowed(body.source_url, ALLOWED_SOURCE_SUFFIXES);
  if (!source) {
    return NextResponse.json(
      { ok: false, error: "source_url host not allowed" },
      { status: 400 },
    );
  }
  const upload = hostAllowed(body.upload_url, ALLOWED_UPLOAD_SUFFIXES);
  if (!upload) {
    return NextResponse.json(
      { ok: false, error: "upload_url host not allowed" },
      { status: 400 },
    );
  }

  // 1. Fetch source.
  let srcRes: Response;
  try {
    srcRes = await fetch(source.toString(), {
      method: "GET",
      headers: (body.source_headers as Record<string, string> | undefined) ?? {},
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "source fetch failed",
        body: (err as Error).message ?? String(err),
      },
      { status: 502 },
    );
  }
  if (!srcRes.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "source fetch failed",
        status: srcRes.status,
        body: await readTruncated(srcRes),
      },
      { status: 502 },
    );
  }

  const srcBytes = await srcRes.arrayBuffer();
  const bytes = srcBytes.byteLength;

  // 2. PUT to upload_url. Pass the bytes through; let caller-supplied
  //    headers (e.g. x-ms-blob-type, content-type) drive Azure's accept.
  let putRes: Response;
  try {
    putRes = await fetch(upload.toString(), {
      method: "PUT",
      headers:
        (body.upload_headers as Record<string, string> | undefined) ?? {},
      body: srcBytes,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "upload PUT failed",
        body: (err as Error).message ?? String(err),
      },
      { status: 502 },
    );
  }
  if (!putRes.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "upload PUT failed",
        status: putRes.status,
        body: await readTruncated(putRes),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    bytes,
    status: putRes.status,
  });
}
