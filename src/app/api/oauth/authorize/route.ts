/**
 * Authorization endpoint. claude.ai redirects the user's browser here with
 * client_id, redirect_uri, code_challenge (PKCE S256), state, and (usually)
 * response_type=code.
 *
 * GET  → render an HTML consent form: "Authorize <client_name> to use the
 *        MCP image generator? Enter the admin password."
 * POST → verify password, mint an authorization_code, 302 to redirect_uri
 *        with `code=<code>&state=<state>`.
 *
 * The form re-submits to this same URL via a hidden field for each OAuth
 * param so we don't need a session.
 */
import { NextResponse } from "next/server";
import {
  ADMIN_PASSWORD,
  createAuthorizationCode,
  getClient,
  oauthConfigured,
  safeStringEq,
} from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AuthParams {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
  scope: string;
}

function paramsFromQuery(url: URL): Partial<AuthParams> {
  return {
    client_id: url.searchParams.get("client_id") ?? "",
    redirect_uri: url.searchParams.get("redirect_uri") ?? "",
    response_type: url.searchParams.get("response_type") ?? "",
    code_challenge: url.searchParams.get("code_challenge") ?? "",
    code_challenge_method: url.searchParams.get("code_challenge_method") ?? "",
    state: url.searchParams.get("state") ?? "",
    scope: url.searchParams.get("scope") ?? "",
  };
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderForm(params: AuthParams, clientName: string, error?: string) {
  const e = (s: string) => htmlEscape(s);
  const errBlock = error
    ? `<div class="error">${e(error)}</div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Authorize MCP image generator</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #f7f5f0; color: #1c1c1c;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #1a1a1a; color: #f0eee8; }
    .card { background: #232323; border-color: #333; }
    input { background: #1a1a1a; border-color: #444; color: inherit; }
  }
  .card {
    background: white; border: 1px solid #e8e4dc; border-radius: 14px;
    padding: 32px; max-width: 420px; width: calc(100% - 32px);
    box-shadow: 0 8px 30px rgba(0,0,0,0.06);
  }
  h1 { margin: 0 0 4px; font-size: 22px; font-weight: 500; letter-spacing: -0.01em; }
  .sub { color: #666; font-size: 14px; margin: 0 0 20px; line-height: 1.5; }
  .client { font-weight: 500; }
  label { display: block; font-size: 12px; color: #666; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.08em; }
  input {
    width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 14px;
    border: 1px solid #d8d2c4; border-radius: 8px; background: #fdfbf6;
    outline: none;
  }
  input:focus { border-color: #888; }
  button {
    width: 100%; padding: 12px; font-size: 14px; font-weight: 500;
    background: #1c1c1c; color: white; border: 0; border-radius: 8px;
    margin-top: 16px; cursor: pointer;
  }
  button:hover { background: #333; }
  .error { color: #b22; font-size: 13px; margin-bottom: 12px; }
  .meta { font-size: 11px; color: #888; margin-top: 16px; line-height: 1.5; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
</style>
</head>
<body>
<form class="card" method="POST" action="/api/oauth/authorize">
  <h1>Authorize MCP image generator</h1>
  <p class="sub"><span class="client">${e(clientName)}</span> wants access to generate images on this DreamMe admin dash.</p>
  ${errBlock}
  <label for="pw">Admin password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required />
  <input type="hidden" name="client_id" value="${e(params.client_id)}" />
  <input type="hidden" name="redirect_uri" value="${e(params.redirect_uri)}" />
  <input type="hidden" name="response_type" value="${e(params.response_type)}" />
  <input type="hidden" name="code_challenge" value="${e(params.code_challenge)}" />
  <input type="hidden" name="code_challenge_method" value="${e(params.code_challenge_method)}" />
  <input type="hidden" name="state" value="${e(params.state)}" />
  <input type="hidden" name="scope" value="${e(params.scope)}" />
  <button type="submit">Authorize</button>
  <div class="meta">redirect: <code>${e(params.redirect_uri)}</code></div>
</form>
</body>
</html>`;
}

function htmlError(message: string, status = 400): Response {
  const body = `<!doctype html><html><body style="font-family:system-ui;padding:40px;max-width:480px;margin:auto;color:#1c1c1c"><h1 style="font-size:20px">Authorization error</h1><p>${htmlEscape(message)}</p></body></html>`;
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function validateAndLoad(
  params: Partial<AuthParams>,
): Promise<
  | { ok: true; full: AuthParams; clientName: string }
  | { ok: false; status: number; message: string }
> {
  if (!oauthConfigured()) {
    return { ok: false, status: 500, message: "OAuth not configured" };
  }
  const required: (keyof AuthParams)[] = [
    "client_id",
    "redirect_uri",
    "response_type",
    "code_challenge",
    "code_challenge_method",
  ];
  for (const k of required) {
    if (!params[k]) {
      return { ok: false, status: 400, message: `missing ${k}` };
    }
  }
  if (params.response_type !== "code") {
    return {
      ok: false,
      status: 400,
      message: `unsupported response_type: ${params.response_type}`,
    };
  }
  if (params.code_challenge_method !== "S256") {
    return {
      ok: false,
      status: 400,
      message: "only code_challenge_method=S256 is supported",
    };
  }
  const client = await getClient(params.client_id!);
  if (!client) {
    return { ok: false, status: 400, message: "unknown client_id" };
  }
  if (!client.redirect_uris.includes(params.redirect_uri!)) {
    return {
      ok: false,
      status: 400,
      message: "redirect_uri does not match registered client",
    };
  }
  return {
    ok: true,
    full: {
      client_id: params.client_id!,
      redirect_uri: params.redirect_uri!,
      response_type: params.response_type!,
      code_challenge: params.code_challenge!,
      code_challenge_method: params.code_challenge_method!,
      state: params.state ?? "",
      scope: params.scope ?? "",
    },
    clientName: client.client_name ?? "An MCP client",
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = paramsFromQuery(url);
  const validated = await validateAndLoad(raw);
  if (!validated.ok) return htmlError(validated.message, validated.status);
  return new Response(renderForm(validated.full, validated.clientName), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  const form = await req.formData();
  const raw: Partial<AuthParams> = {
    client_id: (form.get("client_id") as string | null) ?? "",
    redirect_uri: (form.get("redirect_uri") as string | null) ?? "",
    response_type: (form.get("response_type") as string | null) ?? "",
    code_challenge: (form.get("code_challenge") as string | null) ?? "",
    code_challenge_method:
      (form.get("code_challenge_method") as string | null) ?? "",
    state: (form.get("state") as string | null) ?? "",
    scope: (form.get("scope") as string | null) ?? "",
  };
  const password = (form.get("password") as string | null) ?? "";
  const validated = await validateAndLoad(raw);
  if (!validated.ok) return htmlError(validated.message, validated.status);
  const params = validated.full;

  if (!safeStringEq(password, ADMIN_PASSWORD)) {
    return new Response(
      renderForm(params, validated.clientName, "Wrong password."),
      {
        status: 401,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  let code: string;
  try {
    code = await createAuthorizationCode({
      clientId: params.client_id,
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge,
      codeChallengeMethod: params.code_challenge_method,
      scope: params.scope || undefined,
    });
  } catch (err) {
    return htmlError(`Failed to issue code: ${(err as Error).message}`, 500);
  }

  const redirect = new URL(params.redirect_uri);
  redirect.searchParams.set("code", code);
  if (params.state) redirect.searchParams.set("state", params.state);
  return NextResponse.redirect(redirect.toString(), { status: 302 });
}
