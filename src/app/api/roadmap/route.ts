/**
 * Product Roadmap tab (src/lib/roadmap.ts).
 *
 * GET  — every item, or only those linked to ?feature_request_id=.
 * POST — add an item (lands at the end of its stage). With
 *        feature_request_id, the linked ticket's status follows the stage.
 *
 * Service-role only: roadmap_items has RLS on and no anon policy.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { spGet, spPatch, spPost, supportDbConfigured } from "@/lib/support/db";
import {
  ROADMAP_PRIORITIES,
  ROADMAP_STAGES,
  doneAtFor,
  endPosition,
  requestStatusForStage,
  type RoadmapItem,
} from "@/lib/roadmap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Create = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(5000).optional(),
  stage: z.enum(ROADMAP_STAGES as [string, ...string[]]).optional(),
  priority: z.enum(ROADMAP_PRIORITIES as [string, ...string[]]).optional(),
  area: z.string().trim().max(100).nullable().optional(),
  owner: z.string().trim().max(60).nullable().optional(),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  feature_request_id: z.string().regex(UUID).nullable().optional(),
});

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

export async function GET(req: Request) {
  const bad = guard(req);
  if (bad) return bad;
  try {
    const fr = new URL(req.url).searchParams.get("feature_request_id");
    if (fr && !UUID.test(fr)) {
      return NextResponse.json({ ok: false, error: "bad feature_request_id" }, { status: 400 });
    }
    const filter = fr ? `&feature_request_id=eq.${fr}` : "";
    const items = await spGet<RoadmapItem[]>(
      `roadmap_items?select=*${filter}&order=position.asc`,
    );
    return NextResponse.json({ ok: true, items });
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
      return NextResponse.json(
        { ok: false, error: "invalid payload", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  try {
    const stage = (body.stage ?? "next") as RoadmapItem["stage"];
    const sameStage = await spGet<RoadmapItem[]>(
      `roadmap_items?select=*&stage=eq.${stage}`,
    );
    const [item] = await spPost<RoadmapItem>("roadmap_items", [
      {
        title: body.title,
        notes: body.notes?.trim() ?? "",
        stage,
        priority: body.priority ?? "normal",
        area: body.area || null,
        owner: body.owner || null,
        target_date: body.target_date ?? null,
        feature_request_id: body.feature_request_id ?? null,
        position: endPosition(sameStage, stage),
        done_at: doneAtFor(null, stage, null),
      },
    ]);

    // The ticket now has a plan; say so on the Requests tab too. A failure
    // here leaves the item in place and is reported, not thrown.
    let requestError: string | null = null;
    if (item.feature_request_id) {
      try {
        await spPatch(`feature_requests?id=eq.${item.feature_request_id}`, {
          status: requestStatusForStage(stage),
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
