/**
 * Dynamic Client Registration (RFC 7591). claude.ai POSTs here with its
 * desired redirect_uris and gets back a client_id. Public clients (PKCE,
 * `token_endpoint_auth_method: "none"`) get no client_secret.
 */
import { NextResponse } from "next/server";
import { oauthConfigured, registerClient } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RegisterBody {
  redirect_uris?: unknown;
  client_name?: unknown;
  token_endpoint_auth_method?: unknown;
  grant_types?: unknown;
  scope?: unknown;
}

export async function POST(req: Request) {
  if (!oauthConfigured()) {
    return NextResponse.json(
      { error: "server_error", error_description: "OAuth not configured" },
      { status: 500 },
    );
  }
  let body: RegisterBody;
  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return NextResponse.json(
      { error: "invalid_client_metadata" },
      { status: 400 },
    );
  }

  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  if (redirectUris.length === 0) {
    return NextResponse.json(
      {
        error: "invalid_redirect_uri",
        error_description: "redirect_uris is required",
      },
      { status: 400 },
    );
  }
  for (const u of redirectUris) {
    try {
      const parsed = new URL(u);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("non-http");
      }
    } catch {
      return NextResponse.json(
        {
          error: "invalid_redirect_uri",
          error_description: `redirect_uri ${u} is not a valid http(s) URL`,
        },
        { status: 400 },
      );
    }
  }

  const clientName =
    typeof body.client_name === "string" ? body.client_name : undefined;
  const tokenAuth =
    typeof body.token_endpoint_auth_method === "string"
      ? body.token_endpoint_auth_method
      : "none";
  const grantTypes = Array.isArray(body.grant_types)
    ? body.grant_types.filter((g): g is string => typeof g === "string")
    : undefined;
  const scope = typeof body.scope === "string" ? body.scope : undefined;

  let client;
  try {
    client = await registerClient({
      redirectUris,
      clientName,
      tokenEndpointAuthMethod: tokenAuth,
      grantTypes,
      scope,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "server_error", error_description: (err as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: client.token_endpoint_auth_method,
      grant_types: client.grant_types,
      ...(client.scope ? { scope: client.scope } : {}),
    },
    {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
