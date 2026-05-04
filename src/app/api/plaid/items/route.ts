import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { plaidConfigured } from "@/lib/vendors/plaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  // Tell the UI whether Plaid is set up at all so the Connect button
  // can hide or show a friendly disabled state.
  if (!plaidConfigured()) {
    return NextResponse.json({ ok: true, configured: false, items: [] });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured" },
      { status: 500 },
    );
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/plaid_items?select=item_id,institution_name,last_sync_at,last_sync_error&order=created_at.desc`,
    {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `fetch failed: ${res.status} ${await res.text()}` },
      { status: 500 },
    );
  }
  const items = (await res.json()) as Array<{
    item_id: string;
    institution_name: string | null;
    last_sync_at: string | null;
    last_sync_error: string | null;
  }>;
  return NextResponse.json({ ok: true, configured: true, items });
}
