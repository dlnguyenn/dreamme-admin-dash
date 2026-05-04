import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  getPlaidClient,
  plaidConfigured,
  plaidErrorMessage,
} from "@/lib/vendors/plaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const Body = z.object({
  public_token: z.string().min(1),
  institution_name: z.string().optional(),
});

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
  if (!plaidConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Plaid not configured" },
      { status: 400 },
    );
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured" },
      { status: 500 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid JSON" },
      { status: 400 },
    );
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "invalid payload" },
      { status: 400 },
    );
  }

  try {
    const client = getPlaidClient();
    const exchange = await client.itemPublicTokenExchange({
      public_token: parsed.data.public_token,
    });
    const access_token = exchange.data.access_token;
    const item_id = exchange.data.item_id;

    // Best-effort fetch of the institution name so the UI can display
    // "Chase" instead of an opaque item ID.
    let institutionName: string | null =
      parsed.data.institution_name?.trim() || null;
    if (!institutionName) {
      try {
        const item = await client.itemGet({ access_token });
        const instId = item.data.item.institution_id;
        if (instId) {
          const inst = await client.institutionsGetById({
            institution_id: instId,
            country_codes: [
              // CountryCode enum string literal — typed below as unknown to keep import lean
              "US" as unknown as never,
            ],
          });
          institutionName = inst.data.institution.name ?? null;
        }
      } catch {
        // Non-fatal — UI will fall back to item_id.
      }
    }

    const upsertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/plaid_items?on_conflict=item_id`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({
          item_id,
          access_token,
          institution_name: institutionName,
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (!upsertRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `failed to store item: ${upsertRes.status} ${await upsertRes.text()}`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      item_id,
      institution_name: institutionName,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: plaidErrorMessage(err) },
      { status: 502 },
    );
  }
}
