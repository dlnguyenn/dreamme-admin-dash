/**
 * Apple Ads (formerly Apple Search Ads) Campaign Management API v5, read-only.
 *
 * Auth: an ES256 JWT "client secret" signed with our own EC P-256 key
 * (sub = clientId, iss = teamId, kid = keyId, aud = https://appleid.apple.com)
 * is swapped for a 1-hour bearer token at appleid.apple.com, then every call
 * carries `X-AP-Context: orgId=<org>`. Same flow as claude/scripts/asa/asa.mjs.
 *
 * Env:
 *   ASA_CLIENT_ID, ASA_TEAM_ID, ASA_KEY_ID, ASA_ORG_ID
 *   ASA_PRIVATE_KEY (the PEM contents, "\n" escapes allowed), or
 *   ASA_PEM = a path to the PEM file (local dev only)
 *
 * This module only reads. It never changes a campaign, bid or budget.
 */
import crypto from "node:crypto";
import fs from "node:fs";

const API = "https://api.searchads.apple.com/api/v5";

const b64url = (b: string | Buffer) => Buffer.from(b).toString("base64url");

function privateKey(): string | null {
  if (process.env.ASA_PRIVATE_KEY) return process.env.ASA_PRIVATE_KEY.replace(/\\n/g, "\n");
  if (process.env.ASA_PEM) return fs.readFileSync(process.env.ASA_PEM, "utf8");
  return null;
}

export function asaConfigured(): boolean {
  return (
    !!process.env.ASA_CLIENT_ID &&
    !!process.env.ASA_TEAM_ID &&
    !!process.env.ASA_KEY_ID &&
    !!process.env.ASA_ORG_ID &&
    !!(process.env.ASA_PRIVATE_KEY || process.env.ASA_PEM)
  );
}

function clientSecret(): string {
  const key = privateKey();
  if (!key) throw new Error("ASA_PRIVATE_KEY not set");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: process.env.ASA_KEY_ID }));
  const payload = b64url(
    JSON.stringify({
      sub: process.env.ASA_CLIENT_ID,
      iss: process.env.ASA_TEAM_ID,
      aud: "https://appleid.apple.com",
      iat: now,
      exp: now + 60 * 60,
    }),
  );
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${b64url(sig)}`;
}

let cached: { token: string; exp: number } | null = null;

/** Bearer token. Apple's endpoint returns {"error":"server_error"} now and then, so retry. */
async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  let last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://appleid.apple.com/auth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.ASA_CLIENT_ID ?? "",
        client_secret: clientSecret(),
        scope: "searchadsorg",
      }).toString(),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (res.ok && j?.access_token) {
      cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
      return j.access_token;
    }
    last = `${res.status} ${JSON.stringify(j).slice(0, 200)}`;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`Apple Ads token request failed: ${last}`);
}

export async function asaGet<T>(path: string): Promise<T> {
  return asaCall<T>("GET", path);
}

/** POST is used only for reports, which read data. */
export async function asaReport<T>(path: string, body: unknown): Promise<T> {
  return asaCall<T>("POST", path, body);
}

async function asaCall<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  if (method === "POST" && !path.startsWith("/reports/")) {
    throw new Error("asa client is read-only: POST is allowed only on /reports/");
  }
  const token = await accessToken();
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-AP-Context": `orgId=${process.env.ASA_ORG_ID}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Apple Ads ${method} ${path} ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

/** Every page of a GET list endpoint. */
export async function asaList<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const j = await asaGet<{ data: T[]; pagination?: { totalResults?: number } }>(
      `${path}${sep}limit=1000&offset=${offset}`,
    );
    out.push(...(j.data ?? []));
    const total = j.pagination?.totalResults ?? out.length;
    if (out.length >= total || (j.data ?? []).length === 0) break;
  }
  return out;
}

export interface Money {
  amount: string;
  currency: string;
}
export const money = (m: Money | null | undefined): number | null =>
  m && m.amount != null ? Number(m.amount) : null;

/** Apple's report times are org-local without a zone ("2026-11-17T05:00:00.000"). Keep as UTC-less ISO. */
export const appleTime = (t: string | null | undefined): string | null => (t ? `${t.replace(/Z$/, "")}Z` : null);
