/**
 * Plaid SDK wrapper. Server-only — never import from a "use client"
 * component. The PlaidApi instance is lazily created on first call so
 * the module can be imported in environments that lack credentials
 * (e.g., during build) without throwing.
 *
 * Required env:
 *   PLAID_CLIENT_ID
 *   PLAID_SECRET
 *   PLAID_ENV       sandbox | production  (default: sandbox)
 */

import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  type PlaidError,
} from "plaid";

const CLIENT_ID = process.env.PLAID_CLIENT_ID ?? "";
const SECRET = process.env.PLAID_SECRET ?? "";
const ENV_NAME = (process.env.PLAID_ENV ?? "sandbox").toLowerCase();

export function plaidConfigured(): boolean {
  return !!CLIENT_ID && !!SECRET;
}

export function plaidEnvironmentName(): "sandbox" | "production" {
  return ENV_NAME === "production" ? "production" : "sandbox";
}

let cached: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (!plaidConfigured()) {
    throw new Error(
      "Plaid not configured — set PLAID_CLIENT_ID and PLAID_SECRET",
    );
  }
  if (cached) return cached;
  const basePath =
    PlaidEnvironments[
      plaidEnvironmentName() as keyof typeof PlaidEnvironments
    ];
  if (!basePath) {
    throw new Error(`Unknown PLAID_ENV "${ENV_NAME}"`);
  }
  cached = new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": CLIENT_ID,
          "PLAID-SECRET": SECRET,
        },
      },
    }),
  );
  return cached;
}

export function isPlaidError(err: unknown): err is { response: { data: PlaidError } } {
  return (
    typeof err === "object" &&
    err !== null &&
    "response" in err &&
    typeof (err as { response?: unknown }).response === "object"
  );
}

export function plaidErrorMessage(err: unknown): string {
  if (isPlaidError(err)) {
    const data = err.response.data;
    return `${data.error_code ?? "PLAID_ERROR"}: ${data.error_message ?? "unknown"}`;
  }
  return (err as Error)?.message ?? "unknown error";
}
