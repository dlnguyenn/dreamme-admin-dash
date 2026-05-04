import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { syncAllPlaidItems } from "@/lib/spend/plaid-sync";
import { plaidConfigured } from "@/lib/vendors/plaid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
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
  try {
    const result = await syncAllPlaidItems();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 502 },
    );
  }
}
