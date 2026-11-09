/**
 * PATCH  /api/experiments/:id — update any fields of an entry.
 * DELETE /api/experiments/:id — remove it.
 *
 * Same access check as /api/roadmap/:id.
 */
import { NextResponse } from "next/server";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { spDelete, spGet, spPatch, supportDbConfigured } from "@/lib/support/db";
import { dateRangeError, type ExperimentEntry } from "@/lib/experiment-log";
import { PatchEntry, cleanEntry } from "@/lib/experiment-log-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function guard(req: Request): NextResponse | null {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!supportDbConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  }
  return null;
}

const fail = (e: unknown) =>
  NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const bad = guard(req);
  if (bad) return bad;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });

  let patch: Record<string, unknown>;
  try {
    const parsed = PatchEntry.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "invalid payload", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    patch = cleanEntry(parsed.data as Record<string, unknown>);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  try {
    const [prev] = await spGet<ExperimentEntry[]>(`experiment_log?id=eq.${id}&limit=1`);
    if (!prev) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    const start = (patch.start_date !== undefined ? patch.start_date : prev.start_date) as string | null;
    const end = (patch.end_date !== undefined ? patch.end_date : prev.end_date) as string | null;
    const rangeError = dateRangeError(start, end);
    if (rangeError) return NextResponse.json({ ok: false, error: rangeError }, { status: 400 });

    if ((patch.kind ?? prev.kind) === "change") patch.has_control = false;

    const [entry] = await spPatch<ExperimentEntry>(`experiment_log?id=eq.${id}`, {
      ...patch,
      updated_at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, entry });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const bad = guard(req);
  if (bad) return bad;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  try {
    await spDelete(`experiment_log?id=eq.${id}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
