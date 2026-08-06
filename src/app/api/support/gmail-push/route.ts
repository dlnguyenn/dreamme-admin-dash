/**
 * Gmail Pub/Sub push endpoint — mail is ingested seconds after it arrives.
 *
 * Gmail publishes to topic gmail-support-push (project dreamme-479917); the
 * push subscription delivers here with an OIDC token minted by Google for
 * gmail-push-invoker@…. Verifying that token (signature, audience, caller)
 * is the entire auth story — no shared secret exists.
 *
 * The delivery payload only says "this mailbox changed"; the historyId
 * cursor in the ingest already knows how to diff, so the body is ignored
 * and the push is treated purely as a doorbell.
 *
 * Response protocol:
 *  - 204 ack: work accepted. Ingest runs via waitUntil AFTER the response,
 *    because triage can take minutes and Pub/Sub redelivers anything not
 *    acked within 60s — ack-then-work with the 10-minute cron as the
 *    idempotent backstop beats duplicate deliveries mid-run.
 *  - 429: another run holds the ingest lock. Pub/Sub redelivers with
 *    backoff, and the redelivery picks up whatever that run missed.
 *  - 403: token didn't verify. Pub/Sub will retry (harmlessly) and
 *    eventually dead-letter; anyone else just gets refused.
 */
import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { verifyGoogleOidc } from "@/lib/vendors/google-oidc";
import { pushAudience, pushServiceAccount } from "@/lib/vendors/gmail";
import { gmailConfigured } from "@/lib/support/gmail-ingest";
import { beginGmailPushIngest } from "@/lib/support/ingest";
import { supportDbConfigured } from "@/lib/support/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }
  try {
    await verifyGoogleOidc(token, {
      audience: pushAudience(),
      email: pushServiceAccount(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unauthorized" },
      { status: 403 },
    );
  }

  if (!gmailConfigured() || !supportDbConfigured()) {
    // Misconfiguration, not overload — but 429 keeps Pub/Sub retrying so a
    // missing env var during a redeploy doesn't eat deliveries.
    return NextResponse.json({ error: "not configured" }, { status: 429 });
  }

  const run = await beginGmailPushIngest();
  if (!run) {
    return NextResponse.json({ error: "ingest busy" }, { status: 429 });
  }
  waitUntil(
    run()
      .then((report) => {
        console.log(
          `[gmail-push] ingested ${report.emailsInserted}/${report.emailsFetched}, triaged ${report.threadsTriaged}` +
            (report.legErrors.length
              ? ` — ${report.legErrors.join("; ")}`
              : ""),
        );
      })
      .catch((e) => console.error("[gmail-push] run failed:", e)),
  );
  return new Response(null, { status: 204 });
}
