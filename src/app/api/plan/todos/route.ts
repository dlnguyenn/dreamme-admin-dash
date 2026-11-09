/**
 * April Plan > Todo (src/lib/revenue-plan/todos.ts).
 * GET  — every item.
 * POST — add one at the end of its section.
 * Same access check as /api/roadmap; plan_todos is service-role only.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { spGet, spPost, supportDbConfigured } from "@/lib/support/db";
import { TODO_SECTIONS, endPosition, type PlanTodo } from "@/lib/revenue-plan/todos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Create = z.object({
  title: z.string().trim().min(1).max(300),
  note: z.string().max(2000).optional(),
  section: z.enum(TODO_SECTIONS as [string, ...string[]]).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

function guard(req: Request): NextResponse | null {
  if (!checkIngestAuth(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!supportDbConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase service role not configured" }, { status: 500 });
  }
  return null;
}

const fail = (e: unknown) =>
  NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });

export async function GET(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  try {
    const todos = await spGet<PlanTodo[]>("plan_todos?select=*&order=position.asc&limit=500");
    return NextResponse.json({ ok: true, todos });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  let body: z.infer<typeof Create>;
  try {
    const parsed = Create.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "invalid payload", details: parsed.error.flatten() }, { status: 400 });
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  try {
    const section = (body.section ?? "today") as PlanTodo["section"];
    const existing = await spGet<PlanTodo[]>(`plan_todos?select=*&section=eq.${section}`);
    const [todo] = await spPost<PlanTodo>("plan_todos", [
      {
        title: body.title,
        note: body.note?.trim() ?? "",
        section,
        due_date: body.due_date ?? null,
        position: endPosition(existing, section),
      },
    ]);
    return NextResponse.json({ ok: true, todo });
  } catch (e) {
    return fail(e);
  }
}
