/**
 * Growth AI — Motion-style creative tagging.
 *
 * Tags every spending ad with three AI dimensions (visual format,
 * messaging theme, intended audience) plus a hook type, using Haiku
 * vision over the creative's image + copy. Results persist to
 * ad_creative_tags (service role); a source_hash over the creative
 * fields keeps re-runs free for unchanged ads.
 *
 * Theme labels are drift-controlled: every call gets the existing theme
 * registry and is told to REUSE a label when the angle matches.
 */
import { createHash } from "node:crypto";
import { structuredCall } from "@/lib/growth-tools";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";

export const TAGGER_MODEL_DEFAULT = "claude-haiku-4-5-20251001";

export { VISUAL_FORMATS, VISUAL_FORMAT_LABELS, type VisualFormat } from "@/lib/growth-tagging-shared";
import { VISUAL_FORMATS, type VisualFormat } from "@/lib/growth-tagging-shared";

const HOOK_TYPES = ["question", "confession", "stat", "demo", "pov", "story", "other"] as const;

export interface CreativeTagRow {
  ad_id: string;
  creative_id: string | null;
  visual_format: VisualFormat;
  messaging_theme: string;
  theme_description: string | null;
  audience: string | null;
  hook_type: string | null;
  confidence: number | null;
  model: string;
  source_hash: string;
  tagged_at: string;
}

interface Candidate {
  ad_id: string;
  ad_name: string;
  creative_id: string;
  image_url: string;
  thumbnail_url: string;
  video_id: string;
  headline: string;
  message: string;
  spend: number;
  latest_date: string;
}

// --- small helpers -----------------------------------------------------------

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  return ymd(new Date(Date.now() - n * 86_400_000));
}

async function sbSelect<T>(path: string): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON) throw new Error("Supabase not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase read failed (${path.split("?")[0]}): ${res.status}`);
  return (await res.json()) as T[];
}

export function sourceHash(c: {
  creative_id: string;
  image_url: string;
  thumbnail_url: string;
  video_id: string;
  headline: string;
  message: string;
}): string {
  return createHash("md5")
    .update(
      [c.creative_id, c.image_url, c.thumbnail_url, c.video_id, c.headline, c.message].join("|"),
    )
    .digest("hex");
}

async function fetchImageBase64(url: string): Promise<{ data: string; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
  const mime = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return { data: buf.toString("base64"), mime };
}

// --- candidates + registry ---------------------------------------------------

interface AdInsightCreativeRow {
  ad_id: string;
  date: string;
  ad_name: string | null;
  creative_id: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  video_id: string | null;
  headline: string | null;
  message: string | null;
  spend: string | number;
}

/** Distinct ads with any spend in the last 56d, latest-day creative fields. */
export async function readCandidates(): Promise<Candidate[]> {
  const rows = await sbSelect<AdInsightCreativeRow>(
    `ad_insights_daily?select=ad_id,date,ad_name,creative_id,image_url,thumbnail_url,video_id,headline,message,spend` +
      `&date=gte.${daysAgo(55)}&limit=20000`,
  );
  const byAd = new Map<string, Candidate>();
  for (const r of rows) {
    let c = byAd.get(r.ad_id);
    if (!c) {
      c = {
        ad_id: r.ad_id,
        ad_name: r.ad_name ?? "",
        creative_id: r.creative_id ?? "",
        image_url: r.image_url ?? "",
        thumbnail_url: r.thumbnail_url ?? "",
        video_id: r.video_id ?? "",
        headline: r.headline ?? "",
        message: r.message ?? "",
        spend: 0,
        latest_date: r.date,
      };
      byAd.set(r.ad_id, c);
    }
    c.spend += Number(r.spend) || 0;
    if (r.date >= c.latest_date) {
      c.latest_date = r.date;
      if (r.ad_name) c.ad_name = r.ad_name;
      if (r.creative_id) c.creative_id = r.creative_id;
      if (r.image_url) c.image_url = r.image_url;
      if (r.thumbnail_url) c.thumbnail_url = r.thumbnail_url;
      if (r.video_id) c.video_id = r.video_id;
      if (r.headline) c.headline = r.headline;
      if (r.message) c.message = r.message;
    }
  }
  return [...byAd.values()].filter((c) => c.spend > 0).sort((a, b) => b.spend - a.spend);
}

export async function readExistingTags(): Promise<Map<string, CreativeTagRow>> {
  const rows = await sbSelect<CreativeTagRow>(`ad_creative_tags?select=*&limit=5000`);
  return new Map(rows.map((r) => [r.ad_id, r]));
}

/** Distinct theme labels + descriptions already in use (drift control). */
export function themeRegistryOf(tags: Map<string, CreativeTagRow>): Array<{ label: string; description: string }> {
  const seen = new Map<string, string>();
  for (const t of tags.values()) {
    if (!seen.has(t.messaging_theme)) {
      seen.set(t.messaging_theme, t.theme_description ?? "");
    }
  }
  return [...seen.entries()].map(([label, description]) => ({ label, description }));
}

// --- the tagger --------------------------------------------------------------

const TAG_TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    visual_format: {
      type: "string",
      enum: [...VISUAL_FORMATS],
      description:
        "The dominant visual execution. ugc_talking_head = creator talking to camera ('yapper'); screen_recording = phone/app capture; post_it = handwritten note on paper/post-it; letter_text = text-dominant static (letter, notes-app, comic-sans scribble); montage = fast-cut b-roll mix; comment_response = replying to an on-screen comment; static_illustration = drawn/cartoon static; static_photo = photographic static.",
    },
    messaging_theme: {
      type: "string",
      description:
        "Short reusable Title Case label (2-5 words) for the persuasion angle, e.g. 'Support System', 'Accountability', 'Incorrect Tracking'. REUSE an existing registry label when the ad expresses the same idea; only invent a new label for a genuinely new angle.",
    },
    theme_description: {
      type: "string",
      description: "One sentence describing the persuasion angle, Motion-style.",
    },
    audience: {
      type: "string",
      description: "Who the ad targets, short phrase, e.g. 'GLP-1 users', 'new GLP-1 starters', 'plateau frustration'.",
    },
    hook_type: {
      type: "string",
      enum: [...HOOK_TYPES],
      description: "The opening device: question / confession / stat / demo / pov / story / other.",
    },
    confidence: {
      type: "number",
      description: "0-1 confidence in these tags overall.",
    },
  },
  required: ["visual_format", "messaging_theme", "theme_description", "audience", "confidence"],
};

const TAGGER_SYSTEM = `You tag Meta ad creatives for DreamMe, a GLP-1 companion iOS app (self-care Tamagotchi: shot logging, protein/fiber tracking, virtual pet fish). You will get one creative at a time: an image (full creative for statics, a thumbnail frame for videos) plus the ad's name, headline, and primary text.

Emit tags via the emit_tags tool. Be decisive; the taxonomy descriptions are in the tool schema. For video ads the image is only a thumbnail — weigh the ad name and copy heavily.

Messaging themes are about the PERSUASION ANGLE (the specific belief the ad sells), and they must be GRANULAR: a healthy account runs 4-10 distinct themes, not one umbrella theme. Reuse a registry label only when the ad's PRIMARY angle is genuinely the same; distinct angles deserve distinct labels. Calibration examples of well-scoped theme labels for this product: "Support System" (fills the support gap doctors leave), "Accountability" (keeps you on track), "Incorrect Tracking" (red flags of tracking wrong), "Take Control" (solves late-night anxiety/overwhelm), "Gamification" (pet/streak rewards drive habits), "Instant Insights" (instant GLP-1 meal score), "Makes Life Easier" (all-in-one simplicity). Do NOT default everything into one catch-all label.`;

function isVisualFormat(v: unknown): v is VisualFormat {
  return typeof v === "string" && (VISUAL_FORMATS as readonly string[]).includes(v);
}

interface EmittedTags {
  visual_format: VisualFormat;
  messaging_theme: string;
  theme_description: string;
  audience: string;
  hook_type: string | null;
  confidence: number;
}

function validateTags(v: unknown): EmittedTags {
  const o = v as Record<string, unknown>;
  if (!isVisualFormat(o.visual_format)) throw new Error(`bad visual_format: ${o.visual_format}`);
  const theme = String(o.messaging_theme ?? "").trim();
  if (!theme) throw new Error("empty messaging_theme");
  return {
    visual_format: o.visual_format,
    messaging_theme: theme.slice(0, 60),
    theme_description: String(o.theme_description ?? "").slice(0, 300),
    audience: String(o.audience ?? "").slice(0, 80),
    hook_type:
      typeof o.hook_type === "string" && (HOOK_TYPES as readonly string[]).includes(o.hook_type)
        ? o.hook_type
        : null,
    confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0)),
  };
}

async function upsertTag(row: Omit<CreativeTagRow, "tagged_at">): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("service role not configured");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ad_creative_tags?on_conflict=ad_id`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ ...row, tagged_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`tag upsert failed: ${res.status} ${await res.text()}`);
}

export interface TagBatchResult {
  tagged: number;
  skipped_fresh: number;
  failed: Array<{ ad_id: string; error: string }>;
  remaining: number;
  themes_in_registry: number;
}

export async function tagBatch(params: {
  limit?: number;
  force?: boolean;
  adIds?: string[];
  model?: string;
}): Promise<TagBatchResult> {
  const limit = Math.max(1, Math.min(25, params.limit ?? 20));
  const model = params.model || TAGGER_MODEL_DEFAULT;

  const [candidates, existing] = await Promise.all([readCandidates(), readExistingTags()]);
  const registry = themeRegistryOf(existing);

  let pool = candidates;
  if (params.adIds?.length) {
    const want = new Set(params.adIds);
    pool = pool.filter((c) => want.has(c.ad_id));
  }

  let skippedFresh = 0;
  const work: Candidate[] = [];
  for (const c of pool) {
    const hash = sourceHash(c);
    const cur = existing.get(c.ad_id);
    if (!params.force && cur && cur.source_hash === hash) {
      skippedFresh++;
      continue;
    }
    work.push(c);
  }

  const batch = work.slice(0, limit);
  const failed: Array<{ ad_id: string; error: string }> = [];
  let tagged = 0;

  for (const c of batch) {
    try {
      // Fetch creative bytes server-side — Meta CDN URLs are signed and
      // expire, so we never hand the URL itself to the Anthropic API.
      let image: { data: string; mime: string } | null = null;
      const imgUrl = c.image_url || c.thumbnail_url;
      if (imgUrl) {
        try {
          image = await fetchImageBase64(imgUrl);
        } catch {
          image = null; // expired CDN URL → text-only tagging below
        }
      }

      const registryText = registry.length
        ? `Existing messaging_theme registry (REUSE one of these labels when the angle matches):\n` +
          registry.map((r) => `- ${r.label}${r.description ? ` — ${r.description}` : ""}`).join("\n")
        : "The theme registry is empty — you are naming the first themes.";

      const textBlock =
        `Ad name: ${c.ad_name || "(unnamed)"}\n` +
        `Format: ${c.video_id ? "video (image below is only the thumbnail frame)" : "static image"}\n` +
        `Headline: ${c.headline || "(none)"}\n` +
        `Primary text: ${(c.message || "(none)").slice(0, 600)}\n\n` +
        registryText +
        (image ? "" : "\n\nNOTE: creative image unavailable — tag from name + copy only.") +
        `\n\nTag this creative now via emit_tags.`;

      const content: Array<Record<string, unknown>> = [];
      if (image) {
        content.push({
          type: "image",
          source: { type: "base64", media_type: image.mime, data: image.data },
        });
      }
      content.push({ type: "text", text: textBlock });

      const { value } = await structuredCall<EmittedTags>({
        model,
        system: TAGGER_SYSTEM,
        user: content,
        toolName: "emit_tags",
        toolDescription: "Emit the creative's tags.",
        schema: TAG_TOOL_SCHEMA,
        validate: validateTags,
        maxTokens: 600,
      });

      await upsertTag({
        ad_id: c.ad_id,
        creative_id: c.creative_id || null,
        visual_format: value.visual_format,
        messaging_theme: value.messaging_theme,
        theme_description: value.theme_description || null,
        audience: value.audience || null,
        hook_type: value.hook_type,
        // No image = lower ceiling on how sure we can be.
        confidence: image ? value.confidence : Math.min(value.confidence, 0.5),
        model,
        source_hash: sourceHash(c),
      });

      // Grow the in-run registry so later ads in this batch reuse new labels.
      if (!registry.some((r) => r.label === value.messaging_theme)) {
        registry.push({ label: value.messaging_theme, description: value.theme_description });
      }
      tagged++;
    } catch (e) {
      failed.push({ ad_id: c.ad_id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    tagged,
    skipped_fresh: skippedFresh,
    failed,
    remaining: Math.max(0, work.length - batch.length),
    themes_in_registry: registry.length,
  };
}
