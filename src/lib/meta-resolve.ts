/**
 * Resolve the Meta token + ad account to use: prefer the OAuth-connected
 * account stored via the dashboard's "Login with Facebook" flow, fall back
 * to the META_ACCESS_TOKEN env var. Extracted from the ads-mcp route so
 * /api/growth/act can share it.
 */
import { getActiveConnection } from "@/lib/meta-oauth";

const DEFAULT_ACCOUNT = "act_1575502753719515";

export function defaultAccount(): string {
  return process.env.META_AD_ACCOUNT_ID || DEFAULT_ACCOUNT;
}

/** Normalize an ad account id to the act_ form. */
export function normAcct(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

export async function resolveMeta(): Promise<{ token: string; account: string } | null> {
  try {
    const conn = await getActiveConnection();
    if (conn?.access_token) {
      return { token: conn.access_token, account: conn.default_ad_account_id || defaultAccount() };
    }
  } catch {
    // fall through to env
  }
  const envTok = process.env.META_ACCESS_TOKEN ?? "";
  if (envTok) return { token: envTok, account: defaultAccount() };
  return null;
}

export const NO_META =
  "No Meta connection — connect an account in the dashboard Integrations panel (or set META_ACCESS_TOKEN).";
