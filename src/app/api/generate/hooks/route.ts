import { NextResponse } from "next/server";
import { generateHooksForPersona, anthropicConfigured } from "@/lib/anthropic";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { PERSONA_IDS, type PersonaId } from "@/lib/personas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";

function sbHeaders() {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

interface PostRow {
  id: string;
  persona: PersonaId;
  first_slide_text: string | null;
  hook_normalized: string | null;
  category: string | null;
  view_count: number | null;
}

async function loadPosts(): Promise<PostRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tiktok_posts?select=id,persona,first_slide_text,hook_normalized,category,view_count&order=view_count.desc&limit=2000`,
    { headers: sbHeaders(), cache: "no-store" },
  );
  if (!res.ok)
    throw new Error(`tiktok_posts read failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as PostRow[];
}

async function insertHooks(
  rows: Array<{
    persona: PersonaId;
    hook_text: string;
    rationale: string;
    category: string;
    inspired_by_post_ids: string[];
  }>,
) {
  if (!rows.length) return [];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/generated_hooks`, {
    method: "POST",
    headers: { ...sbHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(`generated_hooks insert failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

interface GenerateBody {
  perPersona?: number;
  personas?: PersonaId[];
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req))
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json(
      { ok: false, error: "Supabase not configured" },
      { status: 500 },
    );
  }
  if (!anthropicConfigured()) {
    return NextResponse.json(
      { ok: false, error: "ANTHROPIC_API_KEY not set" },
      { status: 500 },
    );
  }

  let body: GenerateBody = {};
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    // empty body allowed
  }
  const perPersona = body.perPersona ?? 2;
  const personas = body.personas?.length ? body.personas : PERSONA_IDS;

  const all = await loadPosts();
  const withHook = all.filter(
    (r) => r.first_slide_text && r.first_slide_text.trim().length > 0,
  );

  const hooksByPersona = new Map<PersonaId, PostRow[]>();
  for (const id of PERSONA_IDS) {
    hooksByPersona.set(
      id,
      withHook.filter((r) => r.persona === id),
    );
  }

  const allGenerated: Array<Record<string, unknown>> = [];

  for (const persona of personas) {
    const own = hooksByPersona.get(persona) ?? [];
    const ownTop = own.slice(0, 15).map((r) => ({
      persona,
      hook: r.first_slide_text ?? "",
      views: Number(r.view_count ?? 0),
      category: r.category ?? "other",
      postId: r.id,
    }));

    const ownHookSet = new Set(
      own.map((r) => (r.hook_normalized ?? "").trim()).filter(Boolean),
    );

    const cross: Array<{
      persona: PersonaId;
      hook: string;
      views: number;
      category: string;
      postId: string;
    }> = [];
    for (const otherId of PERSONA_IDS) {
      if (otherId === persona) continue;
      const others = hooksByPersona.get(otherId) ?? [];
      for (const r of others) {
        const norm = (r.hook_normalized ?? "").trim();
        if (!norm || ownHookSet.has(norm)) continue;
        cross.push({
          persona: otherId,
          hook: r.first_slide_text ?? "",
          views: Number(r.view_count ?? 0),
          category: r.category ?? "other",
          postId: r.id,
        });
      }
    }
    cross.sort((a, b) => b.views - a.views);
    const crossTop = cross.slice(0, 15);

    const suggestions = await generateHooksForPersona({
      persona,
      count: perPersona,
      personaTopHooks: ownTop,
      crossPersonaHooks: crossTop,
    });

    for (const s of suggestions) {
      allGenerated.push({
        persona,
        hook_text: s.hook,
        rationale: s.rationale,
        category: s.category,
        inspired_by_post_ids: s.inspiredBy,
      });
    }
  }

  const inserted = (await insertHooks(
    allGenerated as Array<{
      persona: PersonaId;
      hook_text: string;
      rationale: string;
      category: string;
      inspired_by_post_ids: string[];
    }>,
  )) as unknown[];

  return NextResponse.json({ ok: true, generated: inserted.length, rows: inserted });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/generate/hooks",
    auth: "X-DreamMe-Secret: <INGEST_TOKEN or CRON_SECRET>",
    body: {
      perPersona: "optional number (default 2)",
      personas: "optional PersonaId[] (default: all three)",
    },
  });
}
