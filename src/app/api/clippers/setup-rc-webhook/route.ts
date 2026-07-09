/**
 * One-shot setup: register the clipper-attribution RevenueCat webhook via the
 * RC v2 API, using the server-side REVENUECAT_API_KEY (which isn't readable
 * outside this runtime). Idempotent — skips if a webhook already points at our
 * ingest URL. Requires the RC v2 key to have
 * `project_configuration:integrations:read_write` scope.
 *
 * Gate: the caller must present RC_WEBHOOK_SECRET (a value we control) as the
 * Authorization header — so only someone who set that secret can trigger it.
 *
 * This is a bootstrap utility, safe to leave in place (idempotent + gated).
 */
import { NextResponse } from "next/server";
import { safeStringEq } from "@/lib/mcp-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_EVENT_TYPES = [
  "initial_purchase",
  "renewal",
  "cancellation",
  "uncancellation",
  "non_renewing_purchase",
  "expiration",
  "billing_issue",
  "product_change",
  "refund_reversed",
  "transfer",
];

interface WebhookListItem {
  id: string;
  url: string;
  name: string;
}

export async function POST(req: Request) {
  const secret = process.env.RC_WEBHOOK_SECRET ?? "";
  if (!secret || !safeStringEq(req.headers.get("authorization") ?? "", secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const apiKey = process.env.REVENUECAT_API_KEY ?? "";
  const projectId = process.env.REVENUECAT_PROJECT_ID ?? "";
  if (!apiKey || !projectId) {
    return NextResponse.json({ error: "REVENUECAT_API_KEY / PROJECT_ID not set" }, { status: 503 });
  }

  // Bootstrap flexibility: any fields in the request body are merged into the
  // RC create payload, so we can iterate on the exact schema (esp. the auth
  // header field name) via curl without redeploying.
  let overrides: Record<string, unknown> = {};
  try {
    overrides = ((await req.json()) as Record<string, unknown>) ?? {};
  } catch {
    /* no body */
  }
  const eventTypes =
    Array.isArray(overrides.event_types) && overrides.event_types.length
      ? (overrides.event_types as string[])
      : DEFAULT_EVENT_TYPES;

  const base = `https://api.revenuecat.com/v2/projects/${projectId}/integrations/webhooks`;
  const rcHeaders = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const ingestUrl = `${new URL(req.url).origin}/api/ingest/rc-webhook`;

  // 1) idempotency: does a webhook already target our ingest URL?
  const listRes = await fetch(base, { headers: rcHeaders });
  const listText = await listRes.text();
  if (!listRes.ok) {
    return NextResponse.json(
      { step: "list", status: listRes.status, response: safeJson(listText) },
      { status: 502 },
    );
  }
  const existing = (safeJson(listText) as { items?: WebhookListItem[] })?.items ?? [];
  const already = existing.find((w) => w.url === ingestUrl);
  if (already) {
    return NextResponse.json({ ok: true, alreadyExists: true, webhook: already });
  }

  // 2) create — defaults, then overrides from body (event_types handled above)
  const { event_types: _ignored, ...restOverrides } = overrides;
  const payload: Record<string, unknown> = {
    name: "Clipper rev-share attribution",
    url: ingestUrl,
    environment: "production",
    event_types: eventTypes,
    ...restOverrides,
  };
  const createRes = await fetch(base, {
    method: "POST",
    headers: rcHeaders,
    body: JSON.stringify(payload),
  });
  const createText = await createRes.text();
  return NextResponse.json(
    { ok: createRes.ok, step: "create", status: createRes.status, response: safeJson(createText) },
    { status: createRes.ok ? 200 : 502 },
  );
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}
