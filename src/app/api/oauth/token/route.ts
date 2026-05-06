/**
 * Token endpoint. Two grants:
 *
 *   grant_type=authorization_code  (initial exchange after /authorize)
 *     params: code, redirect_uri, client_id, code_verifier
 *   grant_type=refresh_token       (renewal once access_token expires)
 *     params: refresh_token, client_id
 *
 * Returns: { access_token, token_type:"Bearer", expires_in, refresh_token, scope }
 *
 * Body is application/x-www-form-urlencoded per OAuth 2.0; we parse JSON
 * too as a courtesy for clients that mis-send.
 */
import { NextResponse } from "next/server";
import {
  consumeAuthorizationCode,
  consumeRefreshToken,
  getClient,
  issueTokens,
  oauthConfigured,
  safeStringEq,
  verifyPkce,
} from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TokenParams {
  grant_type?: string;
  code?: string;
  redirect_uri?: string;
  client_id?: string;
  client_secret?: string;
  code_verifier?: string;
  refresh_token?: string;
  scope?: string;
}

async function readBody(req: Request): Promise<TokenParams> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return (await req.json()) as TokenParams;
    } catch {
      return {};
    }
  }
  // Default to URL-encoded form.
  const text = await req.text();
  const parsed = new URLSearchParams(text);
  const out: TokenParams = {};
  for (const [k, v] of parsed.entries()) {
    (out as Record<string, string>)[k] = v;
  }
  return out;
}

function basicAuthCreds(req: Request): { id: string; secret: string } | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Basic\s+(.+)$/i.exec(h);
  if (!m) return null;
  try {
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    return {
      id: decodeURIComponent(decoded.slice(0, idx)),
      secret: decodeURIComponent(decoded.slice(idx + 1)),
    };
  } catch {
    return null;
  }
}

function err(code: string, description: string, status = 400) {
  return NextResponse.json(
    { error: code, error_description: description },
    {
      status,
      headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
    },
  );
}

export async function POST(req: Request) {
  if (!oauthConfigured()) {
    return err("server_error", "OAuth not configured", 500);
  }
  const body = await readBody(req);
  const grant = body.grant_type ?? "";

  // Resolve client_id from body or HTTP Basic.
  const basic = basicAuthCreds(req);
  const clientId = body.client_id ?? basic?.id ?? "";
  const clientSecret = body.client_secret ?? basic?.secret ?? "";
  if (!clientId) return err("invalid_client", "missing client_id");

  const client = await getClient(clientId);
  if (!client) return err("invalid_client", "unknown client_id", 401);

  // Confidential clients must present their secret.
  if (
    client.client_secret &&
    !safeStringEq(clientSecret ?? "", client.client_secret)
  ) {
    return err("invalid_client", "bad client_secret", 401);
  }

  if (grant === "authorization_code") {
    const code = body.code ?? "";
    const redirectUri = body.redirect_uri ?? "";
    const verifier = body.code_verifier ?? "";
    if (!code || !redirectUri || !verifier) {
      return err(
        "invalid_request",
        "code, redirect_uri, and code_verifier are required",
      );
    }
    const consumed = await consumeAuthorizationCode(code);
    if (!consumed) return err("invalid_grant", "code is invalid or expired");
    if (consumed.client_id !== clientId) {
      return err("invalid_grant", "code was issued to a different client");
    }
    if (consumed.redirect_uri !== redirectUri) {
      return err("invalid_grant", "redirect_uri mismatch");
    }
    if (
      !verifyPkce(verifier, consumed.code_challenge, consumed.code_challenge_method)
    ) {
      return err("invalid_grant", "PKCE verification failed");
    }
    let issued;
    try {
      issued = await issueTokens({ clientId, scope: consumed.scope });
    } catch (e) {
      return err("server_error", (e as Error).message, 500);
    }
    return NextResponse.json(
      {
        access_token: issued.accessToken,
        token_type: "Bearer",
        expires_in: issued.expiresIn,
        refresh_token: issued.refreshToken,
        ...(issued.scope ? { scope: issued.scope } : {}),
      },
      { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  }

  if (grant === "refresh_token") {
    const rt = body.refresh_token ?? "";
    if (!rt) return err("invalid_request", "refresh_token is required");
    const old = await consumeRefreshToken(rt);
    if (!old) return err("invalid_grant", "refresh_token invalid or expired");
    if (old.client_id !== clientId) {
      return err("invalid_grant", "refresh_token was issued to a different client");
    }
    let issued;
    try {
      issued = await issueTokens({ clientId, scope: old.scope });
    } catch (e) {
      return err("server_error", (e as Error).message, 500);
    }
    return NextResponse.json(
      {
        access_token: issued.accessToken,
        token_type: "Bearer",
        expires_in: issued.expiresIn,
        refresh_token: issued.refreshToken,
        ...(issued.scope ? { scope: issued.scope } : {}),
      },
      { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  }

  return err("unsupported_grant_type", `grant_type "${grant}" not supported`);
}
