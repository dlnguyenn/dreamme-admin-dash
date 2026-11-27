/**
 * Sentry-compatible envelope ingest for the Errors tab. Reached through the
 * next.config.ts rewrite of /api/<ERRORS_PROJECT_ID>/envelope/ (the URL the
 * Sentry SDKs build from the DSN). Public on purpose: the DSN's public key is
 * the only check, as on sentry.io. See src/lib/errors/ingest.ts.
 */
import { errorsConfig, handleEnvelope } from "@/lib/errors/ingest";
import { RATE_LIMIT_HEADER } from "@/lib/errors/envelope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  return handleEnvelope(req, errorsConfig().projectId);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Content-Encoding, X-Sentry-Auth",
      "Access-Control-Expose-Headers": "X-Sentry-Rate-Limits, Retry-After",
      "X-Sentry-Rate-Limits": RATE_LIMIT_HEADER,
    },
  });
}
