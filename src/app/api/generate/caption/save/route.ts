import { NextResponse } from "next/server";
import { z } from "zod";
import { isModelId } from "@/lib/models";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { PERSONA_IDS } from "@/lib/personas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";

const Body = z.object({
  hookId: z.string().min(1),
  personaId: z.enum(PERSONA_IDS as [string, ...string[]]),
  caption: z.string().min(1).max(5000),
  model: z.string().refine(isModelId, { message: "invalid model" }),
  notes: z.string().max(2000).optional(),
  tipPoolAware: z.boolean(),
});

function sbHeaders() {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured on server" },
      { status: 500 },
    );
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 400 },
    );
  }

  try {
    const savedRes = await fetch(`${SUPABASE_URL}/rest/v1/saved_captions`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "return=representation" },
      body: JSON.stringify({
        source_delivery_id: null,
        source_hook_id: parsed.hookId,
        persona: parsed.personaId,
        caption: parsed.caption,
      }),
    });
    if (!savedRes.ok) {
      throw new Error(
        `saved_captions insert failed: ${savedRes.status} ${await savedRes.text()}`,
      );
    }
    const savedArr = await savedRes.json();
    const savedCaption = Array.isArray(savedArr) ? savedArr[0] : savedArr;

    const genRes = await fetch(`${SUPABASE_URL}/rest/v1/generated_captions`, {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "return=representation" },
      body: JSON.stringify({
        hook_id: parsed.hookId,
        persona: parsed.personaId,
        caption: parsed.caption,
        model: parsed.model,
        notes: parsed.notes ?? null,
        tip_pool_aware: parsed.tipPoolAware,
      }),
    });
    if (!genRes.ok) {
      throw new Error(
        `generated_captions insert failed: ${genRes.status} ${await genRes.text()}`,
      );
    }
    const genArr = await genRes.json();
    const generatedCaption = Array.isArray(genArr) ? genArr[0] : genArr;

    const markRes = await fetch(
      `${SUPABASE_URL}/rest/v1/generated_hooks?id=eq.${encodeURIComponent(parsed.hookId)}`,
      {
        method: "PATCH",
        headers: sbHeaders(),
        body: JSON.stringify({ used: true }),
      },
    );
    if (!markRes.ok) {
      // Non-fatal â€” caption is saved. Log and continue.
      console.warn(
        `generated_hooks mark-used failed: ${markRes.status} ${await markRes.text()}`,
      );
    }

    return NextResponse.json({
      ok: true,
      savedCaption,
      generatedCaption,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
