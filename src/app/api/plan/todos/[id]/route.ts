/**
 * PATCH  /api/plan/todos/:id — tick or untick (done), or edit the text.
 * DELETE /api/plan/todos/:id — remove it.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { spDelete, spPatch, supportDbConfigured } from "@/lib/support/db";
import { TODO_SECTIONS, type PlanTodo } from "@/lib/revenue-plan/todos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Patch = z
  .object({
    done: z.boolean().optional(),
    title: z.string().trim().min(1).max(300).optional(),
    note: z.string().max(2000).optional(),
    section: z.enum(TODO_SECTIONS as [string, ...string[]]).optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty patch" });

function guard(req: Request): NextResponse | null {
  if (!checkIngestAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
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
  let patch: z.infer<typeof Patch>;
  try {
    const parsed = Patch.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "invalid payload", details: parsed.error.flatten() }, { status: 400 });
    }
    patch = parsed.data;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  try {
    const now = new Date().toISOString();
    const update: Record<string, unknown> = { ...patch, updated_at: now };
    if (patch.done !== undefined) update.done_at = patch.done ? now : null;
    const [todo] = await spPatch<PlanTodo>(`plan_todos?id=eq.${id}`, update);
    if (!todo) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, todo });
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
    await spDelete(`plan_todos?id=eq.${id}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
