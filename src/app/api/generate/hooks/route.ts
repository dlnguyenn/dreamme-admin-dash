import { NextResponse } from "next/server";
import { generateHooksForPersona, anthropicConfigured } from "@/lib/anthropic";
import { checkIngestAuth } from "@/lib/auth-ingest";
import { PERSONA_IDS, type PersonaId } from "@/lib/personas";
import {
  attachOrCreate,
  createPostgrestFamilyStore,
  fetchCategoryCoverage,
} from "@/lib/families";
import { embedOne, voyageConfigured, toPgVector } from "@/lib/voyage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE = (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";

const HITS_WINDOW_DAYS = 60;
const FLOPS_WINDOW_DAYS = 30;

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
  posted_at: string | null;
  performance_ratio: number | null;
  performance_class: "flop" | "mid" | "hit" | null;
}

async function loadPosts(): Promise<PostRow[]> {
  const cutoff = new Date(
    Date.now() - HITS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tiktok_posts?select=id,persona,first_slide_text,hook_normalized,category,view_count,posted_at,performance_ratio,performance_class&posted_at=gte.${cutoff}&order=view_count.desc&limit=2000`,
    { headers: sbHeaders(), cache: "no-store" },
  );
  if (!res.ok)
    throw new Error(`tiktok_posts read failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as PostRow[];
}

interface FatiguedFamilyRow {
  exemplar_text: string;
  category: string | null;
  fatigue_reason: string | null;
  cooldown_until: string | null;
  fatigue_score: number;
}

async function loadFatiguedFamilies(): Promise<FatiguedFamilyRow[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/hook_families?select=exemplar_text,category,fatigue_reason,cooldown_until,fatigue_score&fatigue_score=gt.0&order=fatigue_score.desc&limit=10`,
    { headers: sbHeaders(), cache: "no-store" },
  );
  if (!res.ok) return [];
  return (await res.json()) as FatiguedFamilyRow[];
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

  const ratioOf = (r: PostRow): number =>
    r.performance_ratio != null
      ? r.performance_ratio
      : Number(r.view_count ?? 0) / 10000; // crude pre-baseline fallback
  const flopsCutoff = Date.now() - FLOPS_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const fatigueRows = await loadFatiguedFamilies().catch(() => []);
  const fatiguedFamilies = fatigueRows.map((f) => ({
    exemplarText: f.exemplar_text,
    category: f.category,
    reason: f.fatigue_reason,
    cooldownUntil: f.cooldown_until,
    fatigueScore: f.fatigue_score,
  }));

  const familyStore = voyageConfigured() ? createPostgrestFamilyStore() : null;
  const familyRoster = familyStore ? await familyStore.fetchAll().catch(() => []) : [];

  const allGenerated: Array<Record<string, unknown>> = [];

  for (const persona of personas) {
    const own = hooksByPersona.get(persona) ?? [];

    // Top hits: highest ratio (or view_count fallback) — recent only.
    const ownRanked = [...own].sort((a, b) => ratioOf(b) - ratioOf(a));
    const ownTop = ownRanked.slice(0, 10).map((r) => ({
      persona,
      hook: r.first_slide_text ?? "",
      views: Number(r.view_count ?? 0),
      category: r.category ?? "other",
      postId: r.id,
      performanceRatio: r.performance_ratio,
    }));

    // Flops: posts explicitly labeled 'flop' in the last 30d. Falls back
    // to bottom-N by ratio if no labels yet.
    const flopsCandidates = own.filter((r) => {
      if (!r.posted_at) return false;
      const t = Date.parse(r.posted_at);
      return !isNaN(t) && t > flopsCutoff;
    });
    const labeled = flopsCandidates.filter((r) => r.performance_class === "flop");
    const flopsRanked = labeled.length
      ? labeled.sort((a, b) => ratioOf(a) - ratioOf(b))
      : [...flopsCandidates].sort((a, b) => ratioOf(a) - ratioOf(b));
    const personaFlops = flopsRanked.slice(0, 8).map((r) => ({
      persona,
      hook: r.first_slide_text ?? "",
      views: Number(r.view_count ?? 0),
      category: r.category ?? "other",
      postId: r.id,
      performanceRatio: r.performance_ratio,
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
      performanceRatio: number | null;
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
          performanceRatio: r.performance_ratio,
        });
      }
    }
    cross.sort((a, b) => ratioOf({ performance_ratio: b.performanceRatio, view_count: b.views } as PostRow) - ratioOf({ performance_ratio: a.performanceRatio, view_count: a.views } as PostRow));
    const crossTop = cross.slice(0, 8);

    const coverage = await fetchCategoryCoverage(persona).catch(() => []);
    const categoryNudges = coverage
      .filter((c) => c.post_count <= 2)
      .slice(0, 3)
      .map((c) => ({
        category: c.category,
        postCount: c.post_count,
        avgPerformanceRatio: c.avg_performance_ratio,
      }));

    const suggestions = await generateHooksForPersona({
      persona,
      count: perPersona,
      personaTopHooks: ownTop,
      crossPersonaHooks: crossTop,
      personaFlops,
      fatiguedFamilies,
      categoryNudges,
    });

    for (const s of suggestions) {
      const row: Record<string, unknown> = {
        persona,
        hook_text: s.hook,
        rationale: s.rationale,
        category: s.category,
        inspired_by_post_ids: s.inspiredBy,
      };
      if (familyStore) {
        try {
          const embedding = await embedOne(s.hook);
          const attach = await attachOrCreate(familyStore, familyRoster, {
            embedding,
            exemplar_text: s.hook,
            category: s.category,
          });
          row.embedding = toPgVector(embedding);
          row.family_id = attach.familyId;
        } catch (e) {
          console.warn("[generate-hooks] embed/family-attach failed", e);
        }
      }
      allGenerated.push(row);
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
      personas: "optional PersonaId[] (default: all configured personas)",
    },
  });
}
