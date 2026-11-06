/**
 * POST /api/handoff — post a saved Roadmap card or Feature Requests ticket to
 * #handoffs in Discord, pinging `to`. Takes only ids: the post is built here
 * from the saved record, so this can't be used to post arbitrary text.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { spGet, supportDbConfigured } from "@/lib/support/db";
import { ROADMAP_OWNERS, type RoadmapItem } from "@/lib/roadmap";
import {
  HANDOFF_URL,
  looksLikeSecret,
  requestHandoff,
  roadmapHandoff,
  type HandoffDraft,
} from "@/lib/handoff";
import type { FeatureRequestRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["roadmap", "request"]),
  id: z.string().uuid(),
  to: z.enum(ROADMAP_OWNERS as [string, ...string[]]),
});

const reply = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

async function draftFor(kind: "roadmap" | "request", id: string, origin: string): Promise<HandoffDraft | null> {
  if (kind === "roadmap") {
    const [item] = await spGet<RoadmapItem[]>(`roadmap_items?id=eq.${id}&limit=1`);
    return item ? roadmapHandoff(item, origin) : null;
  }
  const [row] = await spGet<FeatureRequestRow[]>(`feature_requests?id=eq.${id}&limit=1`);
  return row ? requestHandoff(row, origin) : null;
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) return reply(401, "unauthorized");
  if (!supportDbConfigured()) return reply(500, "Supabase service role not configured");
  const token = process.env.HANDOFF_DAD_TOKEN;
  if (!token) return reply(500, "HANDOFF_DAD_TOKEN is not set");

  let body: z.infer<typeof Body>;
  try {
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) return reply(400, "invalid payload");
    body = parsed.data;
  } catch {
    return reply(400, "invalid JSON");
  }

  try {
    const draft = await draftFor(body.kind, body.id, new URL(req.url).origin);
    if (!draft) return reply(404, "not found");
    if (looksLikeSecret(draft)) {
      return reply(400, "This looks like it contains a secret, so nothing was posted. Remove it and try again.");
    }
    const res = await fetch(HANDOFF_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: body.to.toLowerCase(), ...draft }),
    });
    const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok) return reply(502, json.error ?? `Handoff service returned ${res.status}`);
    return NextResponse.json({ ok: true, url: json.url });
  } catch (e) {
    return reply(500, e instanceof Error ? e.message : String(e));
  }
}
