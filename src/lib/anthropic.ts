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
}): Promise<GenerationSuggestion[]> {
  const { persona, count, personaTopHooks, crossPersonaHooks } = opts;

  const fmt = (h: HookExample) =>
    `[${h.postId}] @${h.persona} · ${h.views.toLocaleString()} views · ${h.category} · ${JSON.stringify(h.hook)}`;

  const sys = `You generate TikTok slideshow hooks for a GLP-1 / weight-loss niche creator named "${persona}".
Rules:
- Hooks are short first-slide text overlays, typically 4-12 words.
- They must feel native to TikTok, not like ad copy.
- Do not use hashtags, emoji, or quotation marks in the hook text itself.
- Each hook must clearly fit one of these categories: ${HOOK_CATEGORIES.join(", ")}.
- Output STRICTLY JSON matching this schema: {"hooks": [{"hook": string, "category": string, "rationale": string, "inspiredBy": string[]}]}.
- "inspiredBy" should list post IDs (from the examples) that informed this hook (can be empty).
- "rationale" is 1-2 sentences explaining WHY this hook should work for this persona, grounded in the data.`;

  const user = `Persona: ${persona}
Generate exactly ${count} hooks.

TOP-PERFORMING HOOKS for ${persona} (learn what works for them):
${personaTopHooks.length ? personaTopHooks.map(fmt).join("\n") : "(none yet)"}

TOP-PERFORMING HOOKS from OTHER personas that ${persona} has NOT yet tried (consider cross-pollinating):
${crossPersonaHooks.length ? crossPersonaHooks.map(fmt).join("\n") : "(none available)"}

Balance: at least one of the ${count} should be a cross-pollination from another persona's top hook (if any exist), adapted to ${persona}'s voice.`;

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
