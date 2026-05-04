import { NextResponse } from "next/server";
import { Products, CountryCode } from "plaid";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  getPlaidClient,
  plaidConfigured,
  plaidErrorMessage,
} from "@/lib/vendors/plaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!plaidConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Plaid not configured (set PLAID_CLIENT_ID + PLAID_SECRET)" },
      { status: 400 },
    );
  }

  try {
    const client = getPlaidClient();
    const res = await client.linkTokenCreate({
      user: { client_user_id: "dreamme-admin-dash" },
      client_name: "DreamMe Admin",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      // Webhook is optional but lets Plaid push us when transactions
      // settle without us having to poll. Falls back gracefully when
      // PLAID_WEBHOOK_URL is unset (e.g., on a preview deploy).
      ...(process.env.PLAID_WEBHOOK_URL
        ? { webhook: process.env.PLAID_WEBHOOK_URL }
        : {}),
    });
    return NextResponse.json({
      ok: true,
      link_token: res.data.link_token,
      expiration: res.data.expiration,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: plaidErrorMessage(err) },
      { status: 502 },
    );
  }
}
