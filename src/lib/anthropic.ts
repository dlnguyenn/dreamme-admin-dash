import {
  HOOK_CATEGORIES,
  HOOK_CATEGORY_DESCRIPTIONS,
  HOOK_CATEGORY_LABELS,
  isHookCategory,
  type HookCategory,
} from "./hook-categories";
import type { PersonaId } from "./personas";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const API = "https://api.anthropic.com/v1/messages";
const HAIKU = "claude-haiku-4-5-20251001";
const SONNET = "claude-sonnet-4-6";
const OPUS = "claude-opus-4-7";

export function anthropicConfigured() {
  return !!ANTHROPIC_API_KEY;
}

interface MessageBlock {
  type: string;
  text?: string;
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 529]);

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callClaude(params: {
  model: string;
  system?: string;
  content: Array<Record<string, unknown>>;
  maxTokens?: number;
  maxRetries?: number;
}): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  const maxRetries = params.maxRetries ?? 4;
  let attempt = 0;
  while (true) {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens ?? 1024,
        system: params.system,
        messages: [{ role: "user", content: params.content }],
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { content?: MessageBlock[] };
      return (data.content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("\n")
        .trim();
    }
    const bodyText = await res.text();
    const retryable = RETRYABLE_STATUSES.has(res.status);
    if (!retryable || attempt >= maxRetries) {
      throw new Error(`Anthropic error: ${res.status} ${bodyText}`);
    }
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader
      ? Math.max(0, Math.min(30_000, Number(retryAfterHeader) * 1000))
      : 0;
    const backoff = Math.min(16_000, 500 * Math.pow(2, attempt));
    const jitter = Math.floor(Math.random() * 250);
    await sleep(retryAfterMs || backoff + jitter);
    attempt++;
  }
}

function firstJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const startArr = raw.indexOf("[");
    const s =
      startArr !== -1 && (start === -1 || startArr < start) ? startArr : start;
    const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
    if (s === -1 || end === -1 || end <= s) {
      throw new Error(`Could not parse JSON from: ${raw.slice(0, 200)}`);
    }
    return JSON.parse(raw.slice(s, end + 1));
  }
}

async function fetchImageBase64(url: string): Promise<{ data: string; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image fetch failed: ${res.status}`);
  const mime = res.headers.get("content-type") ?? "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  return { data: buf.toString("base64"), mime };
}

export async function ocrFirstSlide(imageUrl: string): Promise<string> {
  const { data, mime } = await fetchImageBase64(imageUrl);
  const text = await callClaude({
    model: HAIKU,
    system:
      "You extract the primary on-image text (the hook overlay) from TikTok slideshow first slides. Return ONLY the overlay text exactly as it appears — no quotes, no commentary. If no text is visible, return an empty string.",
    content: [
      {
        type: "image",
        source: { type: "base64", media_type: mime, data },
      },
      { type: "text", text: "Extract the hook text from this slide." },
    ],
    maxTokens: 300,
  });
  return text.replace(/^["'\s]+|["'\s]+$/g, "").trim();
}

export async function categorizeHook(hook: string): Promise<HookCategory> {
  if (!hook.trim()) return "other";
  const labelList = HOOK_CATEGORIES.map(
    (id) => `- ${id}: ${HOOK_CATEGORY_LABELS[id]} — ${HOOK_CATEGORY_DESCRIPTIONS[id]}`,
  ).join("\n");
  const text = await callClaude({
    model: HAIKU,
    system:
      "You classify TikTok slideshow hooks into one category. Respond with ONLY the category id, nothing else.",
    content: [
      {
        type: "text",
        text: `Categories:\n${labelList}\n\nHook: ${JSON.stringify(hook)}\n\nReturn the single best category id from the list above.`,
      },
    ],
    maxTokens: 30,
  });
  const id = text.trim().toLowerCase().replace(/[^a-z_]/g, "");
  return isHookCategory(id) ? id : "other";
}

export interface HookExample {
  persona: PersonaId;
  hook: string;
  views: number;
  category: string;
  postId: string;
  performanceRatio?: number | null;
}

export interface FatiguedFamilyExample {
  exemplarText: string;
  category: string | null;
  reason: string | null;
  cooldownUntil: string | null;
  fatigueScore: number;
}

export interface CategoryNudge {
  category: string;
  postCount: number;
  avgPerformanceRatio: number;
}

export interface GenerationSuggestion {
  hook: string;
  category: HookCategory;
  rationale: string;
  inspiredBy: string[];
}

export async function generateHooksForPersona(opts: {
  persona: PersonaId;
  count: number;
  personaTopHooks: HookExample[];
  crossPersonaHooks: HookExample[];
  personaFlops?: HookExample[];
  fatiguedFamilies?: FatiguedFamilyExample[];
  categoryNudges?: CategoryNudge[];
}): Promise<GenerationSuggestion[]> {
  const {
    persona,
    count,
    personaTopHooks,
    crossPersonaHooks,
    personaFlops = [],
    fatiguedFamilies = [],
    categoryNudges = [],
  } = opts;

  const fmt = (h: HookExample) => {
    const ratio =
      h.performanceRatio != null
        ? ` · ${h.performanceRatio < 10 ? h.performanceRatio.toFixed(2) : h.performanceRatio.toFixed(0)}× baseline`
        : "";
    return `[${h.postId}] @${h.persona} · ${h.views.toLocaleString()} views${ratio} · ${h.category} · ${JSON.stringify(h.hook)}`;
  };

  const sys = `You generate TikTok slideshow hooks for a GLP-1 / weight-loss niche creator named "${persona}".
Rules:
- Hooks are short first-slide text overlays, typically 4-12 words.
- They must feel native to TikTok, not like ad copy.
- Do not use hashtags, emoji, or quotation marks in the hook text itself.
- Each hook must clearly fit one of these categories: ${HOOK_CATEGORIES.join(", ")}.
- Output STRICTLY JSON matching this schema: {"hooks": [{"hook": string, "category": string, "rationale": string, "inspiredBy": string[]}]}.
- "inspiredBy" should list post IDs (from the examples) that informed this hook (can be empty).
- "rationale" is 1-2 sentences explaining WHY this hook should work for this persona, grounded in the data.

You will see SIGNAL SECTIONS below (top hits, recent flops, fatigued families to avoid, under-explored categories). Use them. Hits show you what works; flops show you what does not work right now; fatigued families are exhausted and must NOT be reused (write something semantically distinct); under-explored categories are angles this persona's audience hasn't seen recently and may respond to.`;

  const fatigueSection = fatiguedFamilies.length
    ? fatiguedFamilies
        .slice(0, 10)
        .map(
          (f) =>
            `- ${JSON.stringify(f.exemplarText)} (${f.category ?? "uncat"}, fatigue ${f.fatigueScore.toFixed(2)}, reason: ${f.reason ?? "n/a"}${
              f.cooldownUntil ? `, cooldown until ${f.cooldownUntil.slice(0, 10)}` : ""
            })`,
        )
        .join("\n")
    : "(none)";

  const nudgeSection = categoryNudges.length
    ? categoryNudges
        .slice(0, 3)
        .map(
          (n) =>
            `- ${n.category} (only ${n.postCount} post${n.postCount === 1 ? "" : "s"} from ${persona} in last 30d, avg ratio ${n.avgPerformanceRatio.toFixed(2)})`,
        )
        .join("\n")
    : "(no signal)";

  const user = `Persona: ${persona}
Generate exactly ${count} hooks.

TOP-PERFORMING HOOKS for ${persona} (recent hits — learn what works for them):
${personaTopHooks.length ? personaTopHooks.slice(0, 10).map(fmt).join("\n") : "(none yet)"}

RECENT FLOPS for ${persona} (anti-examples — these underperformed; avoid these patterns):
${personaFlops.length ? personaFlops.slice(0, 8).map(fmt).join("\n") : "(none flagged)"}

TOP-PERFORMING HOOKS from OTHER personas that ${persona} has NOT yet tried (cross-pollinate where you can):
${crossPersonaHooks.length ? crossPersonaHooks.slice(0, 8).map(fmt).join("\n") : "(none available)"}

FATIGUED FAMILIES to AVOID (in cooldown — do NOT propose hooks similar to these; pick a different angle entirely):
${fatigueSection}

UNDER-EXPLORED CATEGORIES for ${persona} (consider these angles — fewer posts = open territory):
${nudgeSection}

Balance: at least one of the ${count} should be a cross-pollination from another persona's top hook (adapted to ${persona}'s voice). At least one should target an under-explored category if any are listed. None should be similar to a fatigued family.`;

  const raw = await callClaude({
    model: SONNET,
    system: sys,
    content: [{ type: "text", text: user }],
    maxTokens: 1500,
  });
  const parsed = firstJson(raw) as { hooks?: GenerationSuggestion[] };
  const hooks = Array.isArray(parsed?.hooks) ? parsed.hooks : [];
  return hooks
    .filter((h) => h && typeof h.hook === "string" && h.hook.trim())
    .map((h) => ({
      hook: h.hook.trim(),
      category: isHookCategory(h.category) ? h.category : "other",
      rationale: typeof h.rationale === "string" ? h.rationale : "",
      inspiredBy: Array.isArray(h.inspiredBy)
        ? h.inspiredBy.filter((x): x is string => typeof x === "string")
        : [],
    }))
    .slice(0, count);
}

// ---------------------------------------------------------------------------
// Pipeline hook (n8n Content Pipeline endpoint, Opus 4.7)
//
// Two divergent prompts depending on whether the persona's recent posts hit
// viral velocity. Explore mode pushes new categories / cross-pollination /
// inverted patterns. Exploit mode leans hard on what's already worked.
// ---------------------------------------------------------------------------

export interface PipelineHookInput {
  persona: PersonaId;
  personaName: string;
  personaTagline: string;
  personaVoice: string;
  mode: "explore" | "exploit";
  recentPosts: Array<{
    postId: string;
    hook: string;
    views: number;
    postedAt: string;
    category: string;
    performanceClass: string | null;
  }>;
  topHistoricalHits: Array<{
    postId: string;
    hook: string;
    views: number;
    category: string;
  }>;
  recentViralPosts: Array<{ postId: string; hook: string; views: number }>;
  crossPersonaWinners: Array<{
    persona: PersonaId;
    postId: string;
    hook: string;
    views: number;
    category: string;
  }>;
  underExploredCategories: string[];
  hooksToAvoid: string[];
}

export interface PipelineHookOutput {
  hook: string;
  rationale: string;
  category: HookCategory;
  inspiredBy: string[];
}

function fmtPost(p: {
  postId: string;
  hook: string;
  views: number;
  category?: string;
  postedAt?: string;
}): string {
  const date = p.postedAt ? ` · ${p.postedAt.slice(0, 10)}` : "";
  const cat = p.category ? ` · ${p.category}` : "";
  return `[${p.postId}] ${p.views.toLocaleString()} views${cat}${date} · ${JSON.stringify(p.hook)}`;
}

function buildExploitPrompt(input: PipelineHookInput): {
  system: string;
  user: string;
} {
  const system = `You generate ONE TikTok slideshow hook for "${input.personaName}", a GLP-1 / weight-loss creator. Persona voice: ${input.personaVoice}.

Mode: EXPLOIT. The audience has been TEPID on this persona's recent content — none of the last ${input.recentPosts.length} posts hit viral velocity. This is not the moment to take risks. Lean hard on what has historically worked for this persona. Identify the angles, structures, and categories that drove their top hits, and write a hook that fits squarely into that proven territory. You are NOT trying to be novel — you are giving the audience MORE of what they have already shown they like.

Rules:
- Hooks are short first-slide text overlays, typically 4-12 words.
- Native TikTok voice, not ad copy.
- No hashtags, emoji, or quotation marks in the hook text itself.
- Each hook must clearly fit one of these categories: ${HOOK_CATEGORIES.join(", ")}.
- Output STRICTLY JSON: {"hook": string, "rationale": string, "category": string, "inspiredBy": string[]}
- "inspiredBy" lists post IDs from the historical hits that informed this hook.
- "rationale" is 1-2 sentences explaining WHY this exact hook will work for this persona, grounded in the data below.`;

  const user = `Persona: ${input.personaName} (${input.personaTagline})

LAST ${input.recentPosts.length} POSTS (none viral — audience is tepid):
${input.recentPosts.length ? input.recentPosts.map(fmtPost).join("\n") : "(none)"}

TOP HISTORICAL HITS for ${input.personaName} (these are the proven winners — ground your hook in their patterns):
${input.topHistoricalHits.length ? input.topHistoricalHits.map(fmtPost).join("\n") : "(none)"}

RECENT HOOKS to AVOID (do not repeat or near-repeat these):
${input.hooksToAvoid.length ? input.hooksToAvoid.map((h) => `- ${JSON.stringify(h)}`).join("\n") : "(none)"}

Generate ONE hook that lives squarely in this persona's proven territory.`;

  return { system, user };
}

function buildExplorePrompt(input: PipelineHookInput): {
  system: string;
  user: string;
} {
  const system = `You generate ONE TikTok slideshow hook for "${input.personaName}", a GLP-1 / weight-loss creator. Persona voice: ${input.personaVoice}.

Mode: EXPLORE. The audience is HOT — ${input.recentViralPosts.length} of the last ${input.recentPosts.length} posts hit viral velocity. When attention is high, this is the moment to take a creative risk and EXPAND the persona's territory rather than copy the most recent winners. Use this hook to test new ground while audience momentum is on your side.

Tactics:
- Borrow a proven format from another persona that ${input.personaName} has not used yet.
- Push into a category that ${input.personaName} has under-explored recently.
- Invert a high-performing structure (e.g., flip "things I wish I knew" → "things I'm glad I didn't know").
- Shift register: if their last winners were utility-list, try emotional confession; if confessional, try data/stat.

Rules:
- Hooks are short first-slide text overlays, typically 4-12 words.
- Native TikTok voice, not ad copy.
- No hashtags, emoji, or quotation marks in the hook text itself.
- Each hook must clearly fit one of these categories: ${HOOK_CATEGORIES.join(", ")}.
- Output STRICTLY JSON: {"hook": string, "rationale": string, "category": string, "inspiredBy": string[]}
- "inspiredBy" can include post IDs from any of the sections below.
- "rationale" is 1-2 sentences explaining what new territory you are testing and why this is the right moment to test it.`;

  const user = `Persona: ${input.personaName} (${input.personaTagline})

RECENT VIRAL POSTS (the audience is currently engaged — ride this momentum):
${input.recentViralPosts.length ? input.recentViralPosts.map(fmtPost).join("\n") : "(none — falling back to last posts as proxy)"}

LAST ${input.recentPosts.length} POSTS (full context):
${input.recentPosts.length ? input.recentPosts.map(fmtPost).join("\n") : "(none)"}

OTHER PERSONAS' TOP HITS that ${input.personaName} has NOT tried (cross-pollination candidates):
${input.crossPersonaWinners.length ? input.crossPersonaWinners.map((p) => `[${p.postId}] @${p.persona} · ${p.views.toLocaleString()} views · ${p.category} · ${JSON.stringify(p.hook)}`).join("\n") : "(none)"}

UNDER-EXPLORED CATEGORIES for ${input.personaName} (open territory):
${input.underExploredCategories.length ? input.underExploredCategories.map((c) => `- ${c}`).join("\n") : "(no clear gaps)"}

RECENT HOOKS to AVOID (do not repeat or near-repeat these):
${input.hooksToAvoid.length ? input.hooksToAvoid.map((h) => `- ${JSON.stringify(h)}`).join("\n") : "(none)"}

Generate ONE hook that takes a calculated creative risk for ${input.personaName} while the audience is paying attention.`;

  return { system, user };
}

export async function generatePipelineHook(
  input: PipelineHookInput,
): Promise<PipelineHookOutput> {
  const { system, user } =
    input.mode === "explore"
      ? buildExplorePrompt(input)
      : buildExploitPrompt(input);

  const raw = await callClaude({
    model: OPUS,
    system,
    content: [{ type: "text", text: user }],
    maxTokens: 600,
  });

  const parsed = firstJson(raw) as {
    hook?: unknown;
    rationale?: unknown;
    category?: unknown;
    inspiredBy?: unknown;
  };

  const hook =
    typeof parsed?.hook === "string" ? parsed.hook.trim() : "";
  if (!hook) throw new Error("Opus returned no hook");

  const category: HookCategory = isHookCategory(parsed?.category)
    ? parsed.category
    : "other";

  const rationale =
    typeof parsed?.rationale === "string" ? parsed.rationale : "";

  const inspiredBy = Array.isArray(parsed?.inspiredBy)
    ? parsed.inspiredBy.filter((x): x is string => typeof x === "string")
    : [];

  return { hook, rationale, category, inspiredBy };
}
