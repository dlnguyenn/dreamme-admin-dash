/**
 * PATCH  /api/roadmap/:id — edit an item, move it (stage + position).
 * DELETE /api/roadmap/:id — remove it (a linked ticket keeps its status).
 *
 * Moving an item stamps or clears done_at, and a linked Feature Requests
 * ticket's status follows the new stage (src/lib/roadmap.ts).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  spDelete,
  spGet,
  spPatch,
  supportDbConfigured,
} from "@/lib/support/db";
import {
  ROADMAP_PRIORITIES,
  ROADMAP_STAGES,
  doneAtFor,
  requestStatusForStage,
  type RoadmapItem,
} from "@/lib/roadmap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Patch = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().max(5000).optional(),
    stage: z.enum(ROADMAP_STAGES as [string, ...string[]]).optional(),
    priority: z.enum(ROADMAP_PRIORITIES as [string, ...string[]]).optional(),
    area: z.string().trim().max(100).nullable().optional(),
    owner: z.string().trim().max(60).nullable().optional(),
    target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    position: z.number().finite().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty patch" });

function guard(req: Request): NextResponse | null {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!supportDbConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase service role not configured" },
      { status: 500 },
    );
  }
  return null;
}

const fail = (e: unknown) =>
  NextResponse.json(
    { ok: false, error: e instanceof Error ? e.message : String(e) },
    { status: 500 },
  );

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const bad = guard(req);
  if (bad) return bad;
  const { id } = await params;

  let patch: z.infer<typeof Patch>;
  try {
    const parsed = Patch.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: "invalid payload", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    patch = parsed.data;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  try {
    const [prev] = await spGet<RoadmapItem[]>(
      `roadmap_items?id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    if (!prev) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

    const update: Record<string, unknown> = {
      ...patch,
      updated_at: new Date().toISOString(),
    };
    for (const k of ["area", "owner"] as const) {
      if (patch[k] === "") update[k] = null;
    }
    const stageChanged = !!patch.stage && patch.stage !== prev.stage;
    if (patch.stage) {
      update.done_at = doneAtFor(prev.stage, patch.stage as RoadmapItem["stage"], prev.done_at);
    }

    const [item] = await spPatch<RoadmapItem>(
      `roadmap_items?id=eq.${encodeURIComponent(id)}`,
      update,
    );

    let requestError: string | null = null;
    if (stageChanged && item.feature_request_id) {
      try {
        await spPatch(`feature_requests?id=eq.${item.feature_request_id}`, {
          status: requestStatusForStage(item.stage),
          updated_at: new Date().toISOString(),
        });
      } catch (e) {
        requestError = e instanceof Error ? e.message : String(e);
      }
    }
    return NextResponse.json({ ok: true, item, ...(requestError ? { requestError } : {}) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const bad = guard(req);
  if (bad) return bad;
  const { id } = await params;
  try {
    await spDelete(`roadmap_items?id=eq.${encodeURIComponent(id)}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
