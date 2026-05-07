/**
 * Generic byte-relay: GET source_url -> PUT upload_url. Used by both the
 * HTTP endpoint at /api/proxy/upload and the `proxy_upload` MCP tool, so
 * callers blocked from one transport can use the other.
 *
 * No retries. No knowledge of any specific service — caller supplies
 * both URLs and any required PUT headers.
 *
 * Hostname allowlists:
 *   - source_url: *.supabase.co or *.blob.core.windows.net
 *   - upload_url: *.blob.core.windows.net
 */

const ALLOWED_SOURCE_SUFFIXES = [".supabase.co", ".blob.core.windows.net"];
const ALLOWED_UPLOAD_SUFFIXES = [".blob.core.windows.net"];

export interface ProxyUploadArgs {
  sourceUrl: string;
  uploadUrl: string;
  sourceHeaders?: Record<string, string>;
  uploadHeaders?: Record<string, string>;
}

/**
 * Discriminated result. `category` identifies which stage failed so the
 * HTTP wrapper can map to a sensible status (`input` -> 400, others ->
 * 502). The MCP wrapper ignores category and returns a JSON-RPC result.
 */
export type ProxyUploadResult =
  | { ok: true; bytes: number; status: number }
  | {
      ok: false;
      error: string;
      category: "input" | "source" | "upload";
      status?: number;
      body?: string;
    };

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

export async function proxyUpload(
  args: ProxyUploadArgs,
): Promise<ProxyUploadResult> {
  if (!args.sourceUrl) {
    return { ok: false, error: "source_url is required", category: "input" };
  }
  if (!args.uploadUrl) {
    return { ok: false, error: "upload_url is required", category: "input" };
  }
  const source = hostAllowed(args.sourceUrl, ALLOWED_SOURCE_SUFFIXES);
  if (!source) {
    return {
      ok: false,
      error: "source_url host not allowed",
      category: "input",
    };
  }
  const upload = hostAllowed(args.uploadUrl, ALLOWED_UPLOAD_SUFFIXES);
  if (!upload) {
    return {
      ok: false,
      error: "upload_url host not allowed",
      category: "input",
    };
  }

  let srcRes: Response;
  try {
    srcRes = await fetch(source.toString(), {
      method: "GET",
      headers: args.sourceHeaders ?? {},
    });
  } catch (err) {
    return {
      ok: false,
      error: "source fetch failed",
      category: "source",
      body: (err as Error).message ?? String(err),
    };
  }
  if (!srcRes.ok) {
    return {
      ok: false,
      error: "source fetch failed",
      category: "source",
      status: srcRes.status,
      body: await readTruncated(srcRes),
    };
  }

  const srcBytes = await srcRes.arrayBuffer();
  const bytes = srcBytes.byteLength;

  let putRes: Response;
  try {
    putRes = await fetch(upload.toString(), {
      method: "PUT",
      headers: args.uploadHeaders ?? {},
      body: srcBytes,
    });
  } catch (err) {
    return {
      ok: false,
      error: "upload PUT failed",
      category: "upload",
      body: (err as Error).message ?? String(err),
    };
  }
  if (!putRes.ok) {
    return {
      ok: false,
      error: "upload PUT failed",
      category: "upload",
      status: putRes.status,
      body: await readTruncated(putRes),
    };
  }

  return { ok: true, bytes, status: putRes.status };
}

/** Validate a callsite's args object that came in as `unknown` JSON. */
export function parseProxyUploadArgs(
  raw: unknown,
):
  | { ok: true; args: ProxyUploadArgs }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const obj = raw as Record<string, unknown>;
  // Accept both snake_case (HTTP/MCP wire) and camelCase (internal).
  const sourceUrl = obj.source_url ?? obj.sourceUrl;
  const uploadUrl = obj.upload_url ?? obj.uploadUrl;
  const sourceHeaders = obj.source_headers ?? obj.sourceHeaders;
  const uploadHeaders = obj.upload_headers ?? obj.uploadHeaders;
  if (typeof sourceUrl !== "string" || !sourceUrl) {
    return { ok: false, error: "source_url is required" };
  }
  if (typeof uploadUrl !== "string" || !uploadUrl) {
    return { ok: false, error: "upload_url is required" };
  }
  if (sourceHeaders !== undefined && !isStringRecord(sourceHeaders)) {
    return { ok: false, error: "source_headers must be an object of strings" };
  }
  if (uploadHeaders !== undefined && !isStringRecord(uploadHeaders)) {
    return { ok: false, error: "upload_headers must be an object of strings" };
  }
  return {
    ok: true,
    args: {
      sourceUrl,
      uploadUrl,
      sourceHeaders: sourceHeaders as Record<string, string> | undefined,
      uploadHeaders: uploadHeaders as Record<string, string> | undefined,
    },
  };
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  for (const val of Object.values(v as Record<string, unknown>)) {
    if (typeof val !== "string") return false;
  }
  return true;
}
