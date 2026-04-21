import type {
  GeneratedHook,
  GeneratedHookRow,
  TikTokPost,
  TikTokPostRow,
} from "./types";
import { SUPABASE_ANON, SUPABASE_URL } from "./supabase";

const HEADERS = () => ({
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
  "Content-Type": "application/json",
});

function mapPost(row: TikTokPostRow): TikTokPost {
  return {
    id: row.id,
    personaId: row.persona,
    postUrl: row.post_url,
    postedAt: row.posted_at,
    viewCount: Number(row.view_count ?? 0),
    likeCount: Number(row.like_count ?? 0),
    commentCount: Number(row.comment_count ?? 0),
    shareCount: Number(row.share_count ?? 0),
    caption: row.caption ?? "",
    firstSlideUrl: row.first_slide_url ?? "",
    firstSlideText: row.first_slide_text ?? "",
    hookNormalized: row.hook_normalized ?? "",
    category: row.category ?? "other",
    createdAt: row.created_at,
  };
}

function mapGenerated(row: GeneratedHookRow): GeneratedHook {
  return {
    id: row.id,
    personaId: row.persona,
    hookText: row.hook_text,
    rationale: row.rationale ?? "",
    category: row.category ?? "other",
    inspiredByPostIds: row.inspired_by_post_ids ?? [],
    used: !!row.used,
    createdAt: row.created_at,
  };
}

export const HooksAPI = {
  async fetchAll() {
    if (!SUPABASE_URL || !SUPABASE_ANON) {
      return { posts: [] as TikTokPost[], generated: [] as GeneratedHook[] };
    }
    const [postsRes, genRes] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/tiktok_posts?select=*&order=view_count.desc&limit=500`,
        { headers: HEADERS(), cache: "no-store" },
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/generated_hooks?select=*&order=created_at.desc&limit=200`,
        { headers: HEADERS(), cache: "no-store" },
      ),
    ]);
    if (!postsRes.ok) throw new Error(`posts ${postsRes.status}`);
    if (!genRes.ok) throw new Error(`generated ${genRes.status}`);
    const posts = (await postsRes.json()) as TikTokPostRow[];
    const generated = (await genRes.json()) as GeneratedHookRow[];
    return { posts: posts.map(mapPost), generated: generated.map(mapGenerated) };
  },

  async markUsed(id: string, used: boolean): Promise<GeneratedHook> {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/generated_hooks?id=eq.${id}`,
      {
        method: "PATCH",
        headers: { ...HEADERS(), Prefer: "return=representation" },
        body: JSON.stringify({ used }),
      },
    );
    if (!res.ok) throw new Error(`update failed ${res.status}`);
    const data = await res.json();
    return mapGenerated(Array.isArray(data) ? data[0] : data);
  },
};
