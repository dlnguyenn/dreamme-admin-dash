import type { PersonaId } from "@/lib/personas";
import { normalizeHook } from "@/lib/hook-categories";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";
const MATCH_WINDOW_DAYS = 30;

export interface UnmatchedGenerated {
  id: string;
  persona: PersonaId;
  hook_text: string;
  hook_normalized: string;
  created_at: string;
}

export interface MatcherIndex {
  byKey: Map<string, UnmatchedGenerated[]>;
  claimed: Set<string>;
}

export interface PendingMatch {
  postId: string;
  postUrl: string;
  persona: PersonaId;
  hookNormalized: string;
  postedAt: string | null;
}

export interface MatcherStore {
  fetchUnmatched(): Promise<UnmatchedGenerated[]>;
  persistMatch(input: {
    generatedHookId: string;
    postId: string;
    deployedAt: string;
    confidence: number;
    source: "auto_normalized" | "auto_embedding" | "manual";
  }): Promise<void>;
}

export function buildIndex(rows: UnmatchedGenerated[]): MatcherIndex {
  const byKey = new Map<string, UnmatchedGenerated[]>();
  const sorted = [...rows].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  for (const r of sorted) {
    const key = `${r.persona}|${r.hook_normalized}`;
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }
  return { byKey, claimed: new Set() };
}

export function tryMatch(
  index: MatcherIndex,
  input: PendingMatch,
): UnmatchedGenerated | null {
  if (!input.hookNormalized) return null;
  const key = `${input.persona}|${input.hookNormalized}`;
  const list = index.byKey.get(key);
  if (!list) return null;
  const postedTs = input.postedAt ? Date.parse(input.postedAt) : NaN;
  for (const candidate of list) {
    if (index.claimed.has(candidate.id)) continue;
    if (!isNaN(postedTs)) {
      const createdTs = Date.parse(candidate.created_at);
      if (!isNaN(createdTs) && createdTs > postedTs) continue;
    }
    index.claimed.add(candidate.id);
    return candidate;
  }
  return null;
}

function sbHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    "Content-Type": "application/json",
  };
}

export function createPostgrestMatcherStore(): MatcherStore {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    throw new Error("Supabase not configured for matcher store");
  }
  return {
    async fetchUnmatched() {
      const cutoff = new Date(
        Date.now() - MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const url = `${SUPABASE_URL}/rest/v1/generated_hooks?select=id,persona,hook_text,created_at&posted_post_id=is.null&created_at=gte.${cutoff}&order=created_at.asc&limit=2000`;
      const res = await fetch(url, { headers: sbHeaders(), cache: "no-store" });
      if (!res.ok)
        throw new Error(
          `generated_hooks read failed: ${res.status} ${await res.text()}`,
        );
      const rows = (await res.json()) as Array<{
        id: string;
        persona: PersonaId;
        hook_text: string;
        created_at: string;
      }>;
      return rows.map((r) => ({
        id: r.id,
        persona: r.persona,
        hook_text: r.hook_text,
        hook_normalized: normalizeHook(r.hook_text),
        created_at: r.created_at,
      }));
    },

    async persistMatch({ generatedHookId, postId, deployedAt, confidence, source }) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/generated_hooks?id=eq.${generatedHookId}`,
        {
          method: "PATCH",
          headers: { ...sbHeaders(), Prefer: "return=minimal" },
          body: JSON.stringify({
            posted_post_id: postId,
            deployed_at: deployedAt,
            match_confidence: confidence,
            match_source: source,
            used: true,
          }),
        },
      );
      if (!res.ok)
        throw new Error(
          `generated_hooks PATCH failed: ${res.status} ${await res.text()}`,
        );
    },
  };
}

export async function loadIndex(store: MatcherStore): Promise<MatcherIndex> {
  const rows = await store.fetchUnmatched();
  return buildIndex(rows);
}
