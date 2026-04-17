import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { signedImageUrls } from "@/lib/storage";

export type Persona = {
  id: string;
  slug: string;
  display_name: string;
};

export type ContentItemRow = {
  id: string;
  persona_id: string;
  image_path: string;
  caption_id: string | null;
  created_at: string;
  run_id: string | null;
};

export type ContentItemView = ContentItemRow & {
  image_url: string | null;
  persona: Persona;
  caption_text: string | null;
};

export async function getPersonas(): Promise<Persona[]> {
  const svc = createSupabaseServiceClient();
  const { data, error } = await svc
    .from("personas")
    .select("id, slug, display_name")
    .order("display_name");
  if (error) throw error;
  return data ?? [];
}

export async function getRecentItemsByPersona(limit = 30): Promise<{
  personas: Persona[];
  itemsByPersona: Record<string, ContentItemView[]>;
}> {
  const svc = createSupabaseServiceClient();
  const personas = await getPersonas();

  const { data: items, error } = await svc
    .from("content_items")
    .select("id, persona_id, image_path, caption_id, created_at, run_id")
    .order("created_at", { ascending: false })
    .limit(limit * personas.length);
  if (error) throw error;

  const paths = (items ?? []).map((i) => i.image_path);
  const urls = await signedImageUrls(paths);

  const byPersona: Record<string, ContentItemView[]> = {};
  for (const p of personas) byPersona[p.id] = [];
  for (const row of items ?? []) {
    const list = byPersona[row.persona_id];
    if (!list || list.length >= limit) continue;
    list.push({
      ...row,
      image_url: urls[row.image_path] ?? null,
      persona: personas.find((p) => p.id === row.persona_id)!,
      caption_text: null,
    });
  }

  return { personas, itemsByPersona: byPersona };
}

export async function getContentItem(id: string): Promise<ContentItemView | null> {
  const svc = createSupabaseServiceClient();
  const { data: item } = await svc
    .from("content_items")
    .select("id, persona_id, image_path, caption_id, created_at, run_id")
    .eq("id", id)
    .single();
  if (!item) return null;

  const [{ data: persona }, urls, caption] = await Promise.all([
    svc
      .from("personas")
      .select("id, slug, display_name")
      .eq("id", item.persona_id)
      .single(),
    signedImageUrls([item.image_path]),
    item.caption_id
      ? svc
          .from("captions")
          .select("text")
          .eq("id", item.caption_id)
          .single()
          .then((r) => r.data?.text ?? null)
      : Promise.resolve(null),
  ]);
  if (!persona) return null;

  return {
    ...item,
    image_url: urls[item.image_path] ?? null,
    persona,
    caption_text: caption,
  };
}

export type CaptionRow = {
  id: string;
  text: string;
  char_count: number;
  tags: string[];
  created_at: string;
  source_run_id: string | null;
};

export async function getCaptions(opts: { search?: string; limit?: number } = {}) {
  const { search, limit = 100 } = opts;
  const svc = createSupabaseServiceClient();
  let query = svc
    .from("captions")
    .select("id, text, char_count, tags, created_at, source_run_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (search && search.trim()) {
    query = query.ilike("text", `%${search.trim()}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as CaptionRow[];
}

export async function getCaptionWithItems(captionId: string) {
  const svc = createSupabaseServiceClient();
  const { data: caption } = await svc
    .from("captions")
    .select("id, text, char_count, tags, created_at, source_run_id")
    .eq("id", captionId)
    .single();
  if (!caption) return null;

  const { data: items } = await svc
    .from("content_items")
    .select("id, persona_id, image_path, created_at, run_id, caption_id")
    .eq("caption_id", captionId);

  const personas = await getPersonas();
  const urls = await signedImageUrls((items ?? []).map((i) => i.image_path));
  const itemViews: ContentItemView[] = (items ?? []).map((row) => ({
    ...row,
    image_url: urls[row.image_path] ?? null,
    persona: personas.find((p) => p.id === row.persona_id)!,
    caption_text: caption.text,
  }));

  return { caption: caption as CaptionRow, items: itemViews };
}

export async function getLastRun() {
  const svc = createSupabaseServiceClient();
  const { data } = await svc
    .from("workflow_runs")
    .select("id, status, triggered_by, started_at, finished_at, n8n_execution_id")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}
