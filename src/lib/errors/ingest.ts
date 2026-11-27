/**
 * The Sentry-compatible ingest endpoint behind /api/<project>/envelope/
 * (next.config.ts rewrites it to /api/errors/envelope).
 *
 * The app's DSN is https://<ERRORS_DSN_PUBLIC_KEY>@<dad host>/<ERRORS_PROJECT_ID>.
 * Responses never use 5xx: the SDKs keep and resend envelopes after a server
 * error, which would turn one bad minute into a retry storm. A storage
 * failure answers 429 with Retry-After instead.
 */
import { categoryOf, decodeBody, EnvelopeError, MAX_BODY_BYTES, parseEnvelope, publicKeyFrom, RATE_LIMIT_HEADER, STORED_ITEM_TYPES } from "./envelope";
import { scrubEvent, summarize } from "./event";
import { ingestEvent } from "./store";

export const errorsConfig = () => ({
  publicKey: process.env.ERRORS_DSN_PUBLIC_KEY?.trim() ?? "",
  projectId: process.env.ERRORS_PROJECT_ID?.trim() || "1",
});

function reply(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Sentry-Rate-Limits": RATE_LIMIT_HEADER,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "X-Sentry-Rate-Limits, Retry-After",
      ...extra,
    },
  });
}

export async function handleEnvelope(req: Request, projectId: string): Promise<Response> {
  const cfg = errorsConfig();
  if (!cfg.publicKey) return reply(200, { id: null, note: "error tracker not configured" });
  if (projectId !== cfg.projectId) return reply(403, { detail: "unknown project" });

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return reply(413, { detail: "envelope too large" });
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) return reply(413, { detail: "envelope too large" });

  let envelope;
  try {
    envelope = parseEnvelope(decodeBody(raw, req.headers.get("content-encoding")));
  } catch (e) {
    return reply(400, { detail: e instanceof EnvelopeError ? e.message : "bad envelope" });
  }

  const key = publicKeyFrom(new URL(req.url), req.headers.get("x-sentry-auth"), envelope.header);
  if (key !== cfg.publicKey) return reply(403, { detail: "bad key" });

  let lastId: string | null = typeof envelope.header.event_id === "string" ? envelope.header.event_id : null;
  const dropped: Record<string, number> = {};
  for (const item of envelope.items) {
    if (!STORED_ITEM_TYPES.has(item.type)) {
      const cat = categoryOf(item.type) ?? item.type;
      dropped[cat] = (dropped[cat] ?? 0) + 1;
      continue;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(item.payload.toString("utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!event.event_id && typeof envelope.header.event_id === "string") event.event_id = envelope.header.event_id;
    const summary = summarize(event);
    lastId = summary.event_id;
    try {
      const r = await ingestEvent(summary, scrubEvent(event));
      if (r.status === "rate_limited") {
        return reply(429, { detail: "rate limited" }, { "Retry-After": "60", "X-Sentry-Rate-Limits": `60:error;default:project:cap,${RATE_LIMIT_HEADER}` });
      }
    } catch (e) {
      console.error("[errors] ingest failed", e instanceof Error ? e.message : e);
      return reply(429, { detail: "try again later" }, { "Retry-After": "300", "X-Sentry-Rate-Limits": `300:error;default:project:unavailable,${RATE_LIMIT_HEADER}` });
    }
  }
  return reply(200, { id: lastId });
}
