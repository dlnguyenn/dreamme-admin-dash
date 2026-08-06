/**
 * One-time: mint GMAIL_REFRESH_TOKEN for the Support Inbox ingest.
 *
 * Usage:
 *   npm run gmail-auth
 *
 * Prerequisites (Dan, in Google Cloud Console — creating credentials is not
 * something this script can do for you):
 *   1. Create/choose a GCP project and enable the **Gmail API**.
 *   2. OAuth consent screen: type "Internal" (dreamme.life is Workspace, so
 *      Internal avoids Google's verification review entirely).
 *   3. Credentials -> Create credentials -> OAuth client ID -> **Web
 *      application**. Add this exact redirect URI:
 *          http://localhost:8787/oauth2callback
 *   4. Put the client id/secret in .env.local as
 *      GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET, then run this.
 *
 * Sign in as dan@dreamme.life when the browser opens. The refresh token is
 * printed once — paste it into .env.local and Vercel as GMAIL_REFRESH_TOKEN.
 * It does not expire unless revoked or unused for six months.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import * as http from "http";
import { exec } from "child_process";

const PORT = 8787;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;
// Read-only is all ingestion needs, and it also covers users.watch for the
// Pub/Sub phase. Writing labels back to Gmail would need gmail.modify and a
// fresh consent, so don't request it until something actually writes.
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function html(body: string): string {
  return `<html><body style="font:16px system-ui;padding:40px">${body}</body></html>`;
}

async function main() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) {
    console.error(
      "\n  GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not set in .env.local.\n" +
        "  See the setup steps at the top of scripts/gmail-auth.ts.\n",
    );
    process.exit(1);
  }

  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: id,
      redirect_uri: REDIRECT,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      // Force a fresh consent so Google actually returns a refresh token —
      // it omits one on repeat authorizations otherwise.
      prompt: "consent",
      login_hint: "dan@dreamme.life",
      state,
    }).toString();

  const code: string = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      if (err) {
        res.writeHead(200, { "Content-Type": "text/html" }).end(html(`<h2>Denied: ${err}</h2>`));
        server.close();
        reject(new Error(`authorization denied: ${err}`));
        return;
      }
      if (url.searchParams.get("state") !== state) {
        res.writeHead(400, { "Content-Type": "text/html" }).end(html("<h2>State mismatch</h2>"));
        server.close();
        reject(new Error("state mismatch — restart the script"));
        return;
      }
      const c = url.searchParams.get("code");
      res
        .writeHead(200, { "Content-Type": "text/html" })
        .end(html("<h2>Authorized.</h2><p>You can close this tab and go back to the terminal.</p>"));
      server.close();
      c ? resolve(c) : reject(new Error("no code returned"));
    });
    server.listen(PORT, () => {
      console.error(`\n  Opening the consent screen. If it doesn't appear, paste this:\n\n  ${authUrl}\n`);
      const open =
        process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
      exec(`${open} "${authUrl}"`, () => {});
    });
    server.on("error", reject);
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }).toString(),
  });
  const body = (await res.json()) as {
    refresh_token?: string;
    access_token?: string;
    error_description?: string;
  };
  if (!res.ok || !body.refresh_token) {
    throw new Error(
      `token exchange failed: ${body.error_description ?? JSON.stringify(body).slice(0, 200)}`,
    );
  }

  // Prove the token works before handing it over.
  const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${body.access_token}` },
  }).then((r) => r.json() as Promise<{ emailAddress?: string; messagesTotal?: number }>);

  console.log(
    `\n  Authorized ${profile.emailAddress} (${profile.messagesTotal} messages).\n\n` +
      `  Add this to .env.local AND to Vercel (Production):\n\n` +
      `GMAIL_REFRESH_TOKEN=${body.refresh_token}\n\n` +
      `  Then run: npm run gmail-check\n`,
  );
}

main().catch((e) => {
  console.error(`\n  ${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
