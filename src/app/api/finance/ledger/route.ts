/**
 * Expense ledger on the Spend tab (src/lib/finance/ledger-store.ts).
 *
 * GET              all rows
 * GET ?format=csv  download, optionally &year=2026
 * POST             upload one Chase activity CSV: { filename, text }
 * PATCH            edit one row: { id, category?, notes?, review? }
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { importChaseCsv, loadLedger, updateLedgerRow } from "@/lib/finance/ledger-store";
import { ledgerCsv } from "@/lib/finance/tax-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
const fail = (e: unknown, status = 500) => NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET(req: Request) {
  if (!checkIngestAuth(req)) return unauthorized();
  try {
    const rows = await loadLedger();
    const params = new URL(req.url).searchParams;
    if (params.get("format") !== "csv") return NextResponse.json({ ok: true, rows });

    const year = params.get("year") ?? "";
    if (year && !/^\d{4}$/.test(year)) return fail(new Error("Bad year"), 400);
    const picked = year ? rows.filter((r) => r.date.startsWith(year)) : rows;
    return new NextResponse(ledgerCsv([...picked].reverse()), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="dreamme-expenses-${year || "all"}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) return unauthorized();
  const body = (await req.json().catch(() => null)) as { filename?: unknown; text?: unknown } | null;
  if (typeof body?.filename !== "string" || typeof body.text !== "string") return fail(new Error("Send filename and text"), 400);
  try {
    return NextResponse.json({ ok: true, ...(await importChaseCsv(body.filename, body.text)) });
  } catch (e) {
    return fail(e, 400);
  }
}

export async function PATCH(req: Request) {
  if (!checkIngestAuth(req)) return unauthorized();
  const body = (await req.json().catch(() => null)) as { id?: unknown; category?: unknown; notes?: unknown; review?: unknown } | null;
  if (typeof body?.id !== "string") return fail(new Error("Send id"), 400);
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  try {
    await updateLedgerRow(body.id, { category: text(body.category), notes: text(body.notes), review: text(body.review) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e, 400);
  }
}
