import { NextResponse } from "next/server";
import { z } from "zod";
import {
  generatePipelineHook,
  anthropicConfigured,
  type PipelineHookInput,
} from "@/lib/anthropic";
import { checkIngestAuth } from "@/lib/auth-ingest";
import {
  PERSONA_IDS,
  PERSONAS,
  isPersonaId,
  type PersonaId,
} from "@/lib/personas";
import { PERSONA_PROFILES } from "@/lib/persona-profiles";
import { loadBaselines, type PersonaBaseline } from "@/lib/baseline";
import {
  computeViralSignal,
  decideMode,
  RECENT_POSTS_TO_EVALUATE,
  type ViralSignal,
} from "@/lib/viral-signal";
import {
  fetchCategoryCoverage,
  attachOrCreate,
  createPostgrestFamilyStore,
} from "@/lib/families";
import { embedOne, voyageConfigured, toPgVector } from "@/lib/voyage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

const Body = z.object({
  persona: z.string().refine(isPersonaId, { message: "invalid persona" }),
});

const RECENT_POSTS_FOR_CONTEXT = 12; // shown to Opus regardless of mode
const TOP_HISTORICAL_HITS = 8; // for exploit prompt
const HOOKS_TO_AVOID_LIMIT = 7;

interface PostRow {
  id: string;
  persona: PersonaId;
  first_slide_text: string | null;
  hook_normalized: string | null;
  category: string | null;
  view_count: number | null;
  posted_at: string | null;
  performance_ratio: number | null;
  performance_class: "flop" | "mid" | "hit" | null;
}

function sbHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

async function fetchPersonaPosts(persona: PersonaId): Promise<PostRow[]> {
  const url = `${SUPABASE_URL}/rest/v1/tiktok_posts?select=id,persona,first_slide_text,hook_normalized,category,view_count,posted_at,performance_ratio,performance_class&persona=eq.${persona}&first_slide_text=not.is.null&order=posted_at.desc&limit=200`;
  const res = await fetch(url, { headers: sbHeaders(), cache: "no-store" });
  if (!res.ok)
    throw new Error(`tiktok_posts read failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as PostRow[];
}

async function fetchOtherPersonasTopHits(
  persona: PersonaId,
  limit = 30,
): Promise<PostRow[]> {
  const url = `${SUPABASE_URL}/rest/v1/tiktok_posts?select=id,persona,first_slide_text,hook_normalized,category,view_count,posted_at,performance_ratio,performance_class&persona=neq.${persona}&first_slide_text=not.is.null&order=view_count.desc&limit=${limit}`;
  const res = await fetch(url, { headers: sbHeaders(), cache: "no-store" });
  if (!res.ok) return [];
  return (await res.json()) as PostRow[];
}

async function fetchRecentHooksToAvoid(
  persona: PersonaId,
): Promise<string[]> {
  // Pull from BOTH generated_hooks (dashboard cron) and pipeline_hooks
  // (this endpoint). Last 30d, last N most recent.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [gen, pipe] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/generated_hooks?select=hook_text,created_at&persona=eq.${persona}&created_at=gte.${cutoff}&order=created_at.desc&limit=20`,
      { headers: sbHeaders(), cache: "no-store" },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/pipeline_hooks?select=hook_text,created_at&persona=eq.${persona}&created_at=gte.${cutoff}&order=created_at.desc&limit=20`,
      { headers: sbHeaders(), cache: "no-store" },
    ),
  ]);
  const all: Array<{ hook_text: string; created_at: string }> = [];
  if (gen.ok) all.push(...((await gen.json()) as typeof all));
  if (pipe.ok) all.push(...((await pipe.json()) as typeof all));
  all.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return all.slice(0, HOOKS_TO_AVOID_LIMIT).map((r) => r.hook_text);
}

function bestRatio(p: PostRow): number {
  return p.performance_ratio != null
    ? p.performance_ratio
    : (p.view_count ?? 0) / 10000;
}

function pickTopHistoricalHits(posts: PostRow[]): PostRow[] {
  const ranked = [...posts].sort((a, b) => bestRatio(b) - bestRatio(a));
  return ranked.slice(0, TOP_HISTORICAL_HITS);
}

async function insertPipelineHook(row: {
  persona: PersonaId;
  hook_text: string;
  rationale: string;
  category: string;
  mode: "explore" | "exploit";
  viral_signal: ViralSignal;
  inspired_by_post_ids: string[];
  embedding: string | null;
  family_id: string | null;
}): Promise<string> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/pipeline_hooks`,
    {
      method: "POST",
      headers: { ...sbHeaders(), Prefer: "return=representation" },
      body: JSON.stringify(row),
    },
  );
  if (!res.ok)
    throw new Error(
      `pipeline_hooks insert failed: ${res.status} ${await res.text()}`,
    );
  const body = (await res.json()) as Array<{ id: string }>;
  const id = body?.[0]?.id;
  if (!id) throw new Error("pipeline_hooks insert returned no id");
  return id;
}

export async function POST(req: Request) {
  if (!checkIngestAuth(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }
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

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 400 },
    );
  }
  const persona = parsed.persona as PersonaId;

  try {
    // 1. Persona profile
    const personaMeta = PERSONAS[persona];
    const personaProfile = PERSONA_PROFILES[persona];

    // 2. Recent posts (sorted desc) + baseline + viral signal
    const allPosts = await fetchPersonaPosts(persona);
    const recentPosts = allPosts.slice(0, RECENT_POSTS_TO_EVALUATE);
    const baselines = await loadBaselines().catch(() => new Map());
    const baseline: PersonaBaseline | null =
      baselines.get(persona) ?? baselines.get("_global") ?? null;
    const viralSignal = computeViralSignal(
      recentPosts.map((p) => ({
        id: p.id,
        view_count: p.view_count,
        posted_at: p.posted_at,
      })),
      baseline,
    );
    const mode = decideMode(viralSignal);

    // 3. Build prompt input
    const recentForContext = allPosts
      .slice(0, RECENT_POSTS_FOR_CONTEXT)
      .map((p) => ({
        postId: p.id,
        hook: p.first_slide_text ?? "",
        views: Number(p.view_count ?? 0),
        postedAt: p.posted_at ?? "",
        category: p.category ?? "other",
        performanceClass: p.performance_class,
      }));

    const topHistoricalHits = pickTopHistoricalHits(allPosts).map((p) => ({
      postId: p.id,
      hook: p.first_slide_text ?? "",
      views: Number(p.view_count ?? 0),
      category: p.category ?? "other",
    }));

    const recentViralPosts = viralSignal.viralPosts
      .map((vp) => {
        const hit = allPosts.find((p) => p.id === vp.id);
        return hit
          ? {
              postId: hit.id,
              hook: hit.first_slide_text ?? "",
              views: Number(hit.view_count ?? 0),
            }
          : null;
      })
      .filter((x): x is { postId: string; hook: string; views: number } => !!x);

    let crossPersonaWinners: PipelineHookInput["crossPersonaWinners"] = [];
    let underExploredCategories: string[] = [];
    if (mode === "explore") {
      const ownNormalized = new Set(
        allPosts
          .map((p) => (p.hook_normalized ?? "").trim())
          .filter(Boolean),
      );
      const others = await fetchOtherPersonasTopHits(persona, 40);
      crossPersonaWinners = others
        .filter((p) => {
          const norm = (p.hook_normalized ?? "").trim();
          return norm && !ownNormalized.has(norm);
        })
        .slice(0, 8)
        .map((p) => ({
          persona: p.persona,
          postId: p.id,
          hook: p.first_slide_text ?? "",
          views: Number(p.view_count ?? 0),
          category: p.category ?? "other",
        }));

      const coverage = await fetchCategoryCoverage(persona).catch(() => []);
      underExploredCategories = coverage
        .filter((c) => c.post_count <= 2)
        .slice(0, 4)
        .map((c) => c.category);
    }

    const hooksToAvoid = await fetchRecentHooksToAvoid(persona);

    const input: PipelineHookInput = {
      persona,
      personaName: personaMeta.name,
      personaTagline: personaMeta.tagline,
      personaVoice: personaProfile.voice,
      mode,
      recentPosts: recentForContext,
      topHistoricalHits,
      recentViralPosts,
      crossPersonaWinners,
      underExploredCategories,
      hooksToAvoid,
    };

    // 4. Opus 4.7 → ONE hook
    const out = await generatePipelineHook(input);

    // 5. Optional embedding + family-attach
    let embedding: string | null = null;
    let familyId: string | null = null;
    if (voyageConfigured()) {
      try {
        const familyStore = createPostgrestFamilyStore();
        const roster = await familyStore.fetchAll();
        const vec = await embedOne(out.hook);
        const attach = await attachOrCreate(familyStore, roster, {
          embedding: vec,
          exemplar_text: out.hook,
          category: out.category,
        });
        embedding = toPgVector(vec);
        familyId = attach.familyId;
      } catch (e) {
        console.warn("[pipeline-hook] embed/family-attach failed", e);
      }
    }

    // 6. Persist
    const hookId = await insertPipelineHook({
      persona,
      hook_text: out.hook,
      rationale: out.rationale,
      category: out.category,
      mode,
      viral_signal: viralSignal,
      inspired_by_post_ids: out.inspiredBy,
      embedding,
      family_id: familyId,
    });

    return NextResponse.json({
      ok: true,
      hookId,
      hook: out.hook,
      rationale: out.rationale,
      category: out.category,
      mode,
      viralSignal: {
        evaluated: viralSignal.evaluated,
        viralCount: viralSignal.viralCount,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/generate/pipeline-hook",
    auth: "X-DreamMe-Secret: <INGEST_TOKEN>",
    body: {
      persona: `required PersonaId — one of ${PERSONA_IDS.join(", ")}`,
    },
    response: {
      ok: true,
      hookId: "uuid",
      hook: "string",
      rationale: "string",
      category: "HookCategory",
      mode: "'explore' | 'exploit'",
      viralSignal: { evaluated: "number", viralCount: "number" },
    },
    notes:
      "Generates ONE hook for the n8n Content Pipeline using Opus 4.7. Decides explore-vs-exploit based on whether any of the persona's last 5 posts hit viral velocity (10k+ views in 48h OR 3x persona median). Persists to pipeline_hooks table — separate from generated_hooks.",
  });
}
