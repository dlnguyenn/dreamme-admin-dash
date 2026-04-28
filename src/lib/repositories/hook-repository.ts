import type { PersonaId } from "@/lib/personas";
import type { PerformanceClass } from "@/lib/baseline";

export interface HookRow {
  persona: PersonaId;
  post_id: string | null;
  post_url: string;
  posted_at: string | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  caption: string;
  first_slide_url: string | null;
  first_slide_text: string;
  hook_normalized: string;
  category: string | null;
  last_scraped_at: string;
  performance_ratio?: number | null;
  performance_class?: PerformanceClass | null;
  embedding?: string | null;
  family_id?: string | null;
}

export interface ExistingHookMeta {
  hook: string;
  category: string;
}

export interface HookRepository {
  fetchExistingMeta(): Promise<Map<string, ExistingHookMeta>>;
  upsert(row: HookRow): Promise<string | null>;
}

export function createPostgrestHookRepository(opts?: {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  existingMetaLimit?: number;
}): HookRepository {
  const url = opts?.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = opts?.serviceRoleKey ?? (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ?? "";
  const limit = opts?.existingMetaLimit ?? 2000;
  if (!url || !key) {
    throw new Error("Supabase not configured for hook repository");
  }

  const headers = (): Record<string, string> => ({
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  });

  return {
    async fetchExistingMeta() {
      const res = await fetch(
        `${url}/rest/v1/tiktok_posts?select=post_url,first_slide_text,hook_normalized,category&limit=${limit}`,
        { headers: headers(), cache: "no-store" },
      );
      if (!res.ok) return new Map();
      const rows = (await res.json()) as Array<{
        post_url: string;
        first_slide_text: string | null;
        category: string | null;
      }>;
      const map = new Map<string, ExistingHookMeta>();
      for (const r of rows) {
        if (r.first_slide_text) {
          map.set(r.post_url, {
            hook: r.first_slide_text,
            category: r.category ?? "other",
          });
        }
      }
      return map;
    },
    async upsert(row) {
      const res = await fetch(
        `${url}/rest/v1/tiktok_posts?on_conflict=post_url`,
        {
          method: "POST",
          headers: {
            ...headers(),
            Prefer: "resolution=merge-duplicates,return=representation",
          },
          body: JSON.stringify(row),
        },
      );
      if (!res.ok) {
        throw new Error(
          `tiktok_posts upsert failed: ${res.status} ${await res.text()}`,
        );
      }
      const body = (await res.json()) as Array<{ id?: string }>;
      return Array.isArray(body) && body[0]?.id ? body[0].id : null;
    },
  };
}

export class InMemoryHookRepository implements HookRepository {
  private rows = new Map<string, HookRow>();

  async fetchExistingMeta(): Promise<Map<string, ExistingHookMeta>> {
    const map = new Map<string, ExistingHookMeta>();
    for (const [url, row] of this.rows) {
      if (row.first_slide_text) {
        map.set(url, {
          hook: row.first_slide_text,
          category: row.category ?? "other",
        });
      }
    }
    return map;
  }

  async upsert(row: HookRow): Promise<string | null> {
    this.rows.set(row.post_url, row);
    return null;
  }

  all(): HookRow[] {
    return Array.from(this.rows.values());
  }

  size(): number {
    return this.rows.size;
  }

  clear(): void {
    this.rows.clear();
  }
}
