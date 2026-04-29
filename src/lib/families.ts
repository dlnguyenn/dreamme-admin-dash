/**
 * Hook families: greedy online clustering of post/hook embeddings, plus
 * fatigue scoring computed from per-family aggregates.
 *
 * Why client-side cosine for clustering instead of a pgvector RPC:
 *   - Family count stays small (<1000 over the lifetime of the project)
 *   - Each scrape pulls all centroids once, then matches in JS — avoids
 *     one RPC roundtrip per post
 *   - Centroid update math (running mean) is the same code that picks
 *     the match, easier to keep consistent
 */

import type { PersonaId } from "@/lib/personas";
import {
  cosineSimilarity,
  toPgVector,
  parsePgVector,
} from "@/lib/voyage";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

export const SIMILARITY_THRESHOLD = 0.92;
export const COOLDOWN_DAYS = 7;
export const FATIGUE_THRESHOLD = 0.6;

export interface FamilyRow {
  id: string;
  centroid: number[];
  exemplar_text: string;
  category: string | null;
  member_count: number;
}

export interface FamilyAttachment {
  familyId: string;
  similarity: number;
  isNew: boolean;
}

function sbHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

export interface FamilyStore {
  fetchAll(): Promise<FamilyRow[]>;
  insert(input: {
    embedding: number[];
    exemplar_text: string;
    category: string | null;
    exemplar_post_id?: string | null;
    exemplar_generated_id?: string | null;
  }): Promise<string>;
  updateCentroid(input: {
    id: string;
    centroid: number[];
    member_count: number;
  }): Promise<void>;
  bulkUpdateFatigue(updates: FatiguePatch[]): Promise<void>;
  fetchFatigueInputs(): Promise<FatigueInputRow[]>;
  listForPersona(persona: PersonaId, limit?: number): Promise<FatiguedFamily[]>;
}

export interface FatigueInputRow {
  family_id: string;
  total_uses_14d: number;
  recent_flop_count_14d: number;
  cross_persona_uses_14d: number;
  last_use_at: string | null;
  last_hit_at: string | null;
}

export interface FatiguePatch {
  id: string;
  total_uses_14d: number;
  recent_flop_count_14d: number;
  cross_persona_uses_14d: number;
  last_use_at: string | null;
  last_hit_at: string | null;
  fatigue_score: number;
  fatigue_reason: string | null;
  cooldown_until: string | null;
}

export interface FatiguedFamily {
  id: string;
  exemplar_text: string;
  category: string | null;
  fatigue_score: number;
  fatigue_reason: string | null;
  cooldown_until: string | null;
  last_use_at: string | null;
  member_count: number;
}

/**
 * Greedy attach: find the closest existing family centroid (within the
 * input's category) that meets SIMILARITY_THRESHOLD. Attach by updating
 * centroid as a running mean and bumping member_count. Otherwise create
 * a new family with this embedding as both centroid and exemplar.
 *
 * Category gate: when both input and family have a category, they must
 * match. Null categories are wildcards (attach freely). This stops
 * structural similarity (e.g. all listicles look alike) from collapsing
 * semantically distinct hooks into one family.
 *
 * NOTE: not safe for concurrent scrape runs against the same family —
 * if two posts attach to the same family in parallel, the second
 * update will clobber the first's centroid. Phase 2 doesn't run scrapes
 * in parallel; revisit if we ever do.
 */
export async function attachOrCreate(
  store: FamilyStore,
  families: FamilyRow[],
  input: {
    embedding: number[];
    exemplar_text: string;
    category: string | null;
    exemplar_post_id?: string | null;
    exemplar_generated_id?: string | null;
  },
): Promise<FamilyAttachment> {
  let bestId: string | null = null;
  let bestSim = -1;
  let bestFamily: FamilyRow | null = null;
  for (const f of families) {
    if (input.category && f.category && input.category !== f.category) continue;
    const sim = cosineSimilarity(input.embedding, f.centroid);
    if (sim > bestSim) {
      bestSim = sim;
      bestId = f.id;
      bestFamily = f;
    }
  }

  if (bestFamily && bestSim >= SIMILARITY_THRESHOLD && bestId) {
    const next = updateCentroidMean(
      bestFamily.centroid,
      bestFamily.member_count,
      input.embedding,
    );
    await store.updateCentroid({
      id: bestId,
      centroid: next,
      member_count: bestFamily.member_count + 1,
    });
    bestFamily.centroid = next;
    bestFamily.member_count += 1;
    return { familyId: bestId, similarity: bestSim, isNew: false };
  }

  const newId = await store.insert({
    embedding: input.embedding,
    exemplar_text: input.exemplar_text,
    category: input.category,
    exemplar_post_id: input.exemplar_post_id ?? null,
    exemplar_generated_id: input.exemplar_generated_id ?? null,
  });
  families.push({
    id: newId,
    centroid: input.embedding,
    exemplar_text: input.exemplar_text,
    category: input.category,
    member_count: 1,
  });
  return { familyId: newId, similarity: 1, isNew: true };
}

export function updateCentroidMean(
  prevCentroid: number[],
  prevCount: number,
  newEmbedding: number[],
): number[] {
  const out = new Array<number>(prevCentroid.length);
  const weight = 1 / (prevCount + 1);
  for (let i = 0; i < prevCentroid.length; i++) {
    out[i] = (prevCentroid[i] * prevCount + newEmbedding[i]) * weight;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fatigue scoring
// ---------------------------------------------------------------------------

export interface FatigueComponents {
  flop_pressure: number;
  recency_pressure: number;
  copycat_pressure: number;
  fatigue_score: number;
  fatigue_reason: string | null;
  cooldown_until: string | null;
}

export function computeFatigue(
  inputs: Pick<
    FatigueInputRow,
    "total_uses_14d" | "recent_flop_count_14d" | "cross_persona_uses_14d" | "last_use_at"
  >,
  now: Date = new Date(),
): FatigueComponents {
  const total = Math.max(1, inputs.total_uses_14d);
  const flop_pressure = inputs.recent_flop_count_14d / total;

  let recency_pressure = 0;
  if (inputs.last_use_at) {
    const ts = Date.parse(inputs.last_use_at);
    if (!isNaN(ts)) {
      const days = (now.getTime() - ts) / (24 * 60 * 60 * 1000);
      recency_pressure = clamp(1 - days / 7, 0, 1);
    }
  }

  const copycat_pressure = clamp(inputs.cross_persona_uses_14d / 5, 0, 1);

  const score =
    0.5 * flop_pressure + 0.3 * recency_pressure + 0.2 * copycat_pressure;

  let reason: string | null = null;
  let cooldown_until: string | null = null;
  if (score > FATIGUE_THRESHOLD) {
    if (flop_pressure >= recency_pressure && flop_pressure >= copycat_pressure)
      reason = "recent_flops";
    else if (recency_pressure >= copycat_pressure) reason = "recent_use";
    else reason = "copycat_saturation";
    cooldown_until = new Date(
      now.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
  }

  return {
    flop_pressure,
    recency_pressure,
    copycat_pressure,
    fatigue_score: score,
    fatigue_reason: reason,
    cooldown_until,
  };
}

export async function recomputeFatigue(
  store: FamilyStore,
): Promise<{ updated: number; fatigued: number }> {
  const inputs = await store.fetchFatigueInputs();
  const patches: FatiguePatch[] = [];
  let fatigued = 0;
  const now = new Date();
  for (const row of inputs) {
    const f = computeFatigue(row, now);
    if (f.cooldown_until) fatigued++;
    patches.push({
      id: row.family_id,
      total_uses_14d: row.total_uses_14d,
      recent_flop_count_14d: row.recent_flop_count_14d,
      cross_persona_uses_14d: row.cross_persona_uses_14d,
      last_use_at: row.last_use_at,
      last_hit_at: row.last_hit_at,
      fatigue_score: f.fatigue_score,
      fatigue_reason: f.fatigue_reason,
      cooldown_until: f.cooldown_until,
    });
  }
  if (patches.length) await store.bulkUpdateFatigue(patches);
  return { updated: patches.length, fatigued };
}

// ---------------------------------------------------------------------------
// Postgrest store
// ---------------------------------------------------------------------------

export function createPostgrestFamilyStore(): FamilyStore {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error("Supabase not configured for family store");
  }
  return {
    async fetchAll() {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/hook_families?select=id,centroid,exemplar_text,category,member_count&limit=2000`,
        { headers: sbHeaders(), cache: "no-store" },
      );
      if (!res.ok)
        throw new Error(
          `hook_families fetch failed: ${res.status} ${await res.text()}`,
        );
      const rows = (await res.json()) as Array<{
        id: string;
        centroid: string;
        exemplar_text: string;
        category: string | null;
        member_count: number;
      }>;
      return rows
        .map((r) => {
          const v = parsePgVector(r.centroid);
          if (!v) return null;
          return {
            id: r.id,
            centroid: v,
            exemplar_text: r.exemplar_text,
            category: r.category,
            member_count: r.member_count,
          } satisfies FamilyRow;
        })
        .filter((x): x is FamilyRow => !!x);
    },

    async insert(input) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/hook_families`,
        {
          method: "POST",
          headers: { ...sbHeaders(), Prefer: "return=representation" },
          body: JSON.stringify({
            centroid: toPgVector(input.embedding),
            exemplar_text: input.exemplar_text,
            category: input.category,
            exemplar_post_id: input.exemplar_post_id ?? null,
            exemplar_generated_id: input.exemplar_generated_id ?? null,
            member_count: 1,
          }),
        },
      );
      if (!res.ok)
        throw new Error(
          `hook_families insert failed: ${res.status} ${await res.text()}`,
        );
      const body = (await res.json()) as Array<{ id: string }>;
      const id = body?.[0]?.id;
      if (!id) throw new Error("hook_families insert returned no id");
      return id;
    },

    async updateCentroid({ id, centroid, member_count }) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/hook_families?id=eq.${id}`,
        {
          method: "PATCH",
          headers: { ...sbHeaders(), Prefer: "return=minimal" },
          body: JSON.stringify({
            centroid: toPgVector(centroid),
            member_count,
          }),
        },
      );
      if (!res.ok)
        throw new Error(
          `hook_families patch failed: ${res.status} ${await res.text()}`,
        );
    },

    async fetchFatigueInputs() {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/family_fatigue_inputs`,
        {
          method: "POST",
          headers: sbHeaders(),
          body: "{}",
        },
      );
      if (!res.ok)
        throw new Error(
          `family_fatigue_inputs rpc failed: ${res.status} ${await res.text()}`,
        );
      return (await res.json()) as FatigueInputRow[];
    },

    async bulkUpdateFatigue(patches) {
      // PATCH-by-id in series. Volumes are small (one row per family,
      // typically <500 over the project's life), and Postgrest doesn't
      // support batched PATCH-by-id without a custom RPC.
      for (const p of patches) {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/hook_families?id=eq.${p.id}`,
          {
            method: "PATCH",
            headers: { ...sbHeaders(), Prefer: "return=minimal" },
            body: JSON.stringify({
              total_uses_14d: p.total_uses_14d,
              recent_flop_count: p.recent_flop_count_14d,
              cross_persona_uses_14d: p.cross_persona_uses_14d,
              last_use_at: p.last_use_at,
              last_hit_at: p.last_hit_at,
              fatigue_score: p.fatigue_score,
              fatigue_reason: p.fatigue_reason,
              cooldown_until: p.cooldown_until,
              computed_at: new Date().toISOString(),
            }),
          },
        );
        if (!res.ok) {
          throw new Error(
            `hook_families fatigue patch failed for ${p.id}: ${res.status} ${await res.text()}`,
          );
        }
      }
    },

    async listForPersona(persona, limit = 10) {
      // Pulls top fatigued families that any generated hook for this
      // persona has touched, ordered by score desc. For Phase 2 we
      // include ALL families (cross-persona signal matters too).
      void persona;
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/hook_families?select=id,exemplar_text,category,fatigue_score,fatigue_reason,cooldown_until,last_use_at,member_count&order=fatigue_score.desc&limit=${limit}`,
        { headers: sbHeaders(), cache: "no-store" },
      );
      if (!res.ok) return [];
      return (await res.json()) as FatiguedFamily[];
    },
  };
}

// ---------------------------------------------------------------------------
// Category coverage (for "under-explored" prompt nudges)
// ---------------------------------------------------------------------------

export interface CategoryCoverageRow {
  category: string;
  post_count: number;
  avg_performance_ratio: number;
}

export async function fetchCategoryCoverage(
  persona: PersonaId,
): Promise<CategoryCoverageRow[]> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return [];
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/category_coverage`,
    {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({ p_persona: persona }),
    },
  );
  if (!res.ok) return [];
  return (await res.json()) as CategoryCoverageRow[];
}
