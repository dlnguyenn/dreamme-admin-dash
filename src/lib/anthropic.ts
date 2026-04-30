import {
  HOOK_CATEGORIES,
  HOOK_CATEGORY_DESCRIPTIONS,
  HOOK_CATEGORY_LABELS,
  isHookCategory,
  type HookCategory,
} from "./hook-categories";
import { MODELS } from "./models";
import type { PersonaId } from "./personas";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const API = "https://api.anthropic.com/v1/messages";
const HAIKU = "claude-haiku-4-5-20251001";
const SONNET = MODELS.SONNET_4_6;
const OPUS = MODELS.OPUS_4_7;

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

export type HookStrategy = "exploit" | "explore";

export interface GenerationSuggestion {
  hook: string;
  category: HookCategory;
  rationale: string;
  inspiredBy: string[];
  strategy: HookStrategy;
}

export async function generateHooksForPersona(opts: {
  persona: PersonaId;
  count: number;
  exploreCount?: number;
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
  // Default split: floor(count/3) explore, rest exploit. So count=3 -> 2/1,
  // count=2 -> 1/1, count=1 -> 1/0.
  const defaultExplore =
    Math.floor(count / 3) > 0 ? Math.floor(count / 3) : count > 1 ? 1 : 0;
  const exploreCount = Math.max(
    0,
    Math.min(count, opts.exploreCount ?? defaultExplore),
  );
  const exploitCount = count - exploreCount;

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
- Each hook is tagged with a "strategy" of either "exploit" or "explore":
  - exploit: closely riffs on a TOP-PERFORMING pattern for ${persona} (or a cross-pollinated top hit). Adapts the proven angle without copying wording. Aim for high expected hit rate.
  - explore: deliberately steps outside known winners — a fresh angle, an under-explored category, an emotional register or hook-shape this persona hasn't tried in the last 30 days. Higher variance, intended to discover new territory.
- Output STRICTLY JSON matching this schema: {"hooks": [{"hook": string, "category": string, "rationale": string, "inspiredBy": string[], "strategy": "exploit" | "explore"}]}.
- "inspiredBy" should list post IDs (from the examples) that informed this hook (can be empty for explore hooks).
- "rationale" is 1-2 sentences explaining WHY this hook should work for this persona AND why it qualifies as exploit vs explore, grounded in the data.

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
Generate exactly ${count} hooks: ${exploitCount} tagged "exploit" and ${exploreCount} tagged "explore".

TOP-PERFORMING HOOKS for ${persona} (recent hits — exploit hooks should riff on these patterns):
${personaTopHooks.length ? personaTopHooks.slice(0, 10).map(fmt).join("\n") : "(none yet)"}

RECENT FLOPS for ${persona} (anti-examples — these underperformed; avoid these patterns even on explore):
${personaFlops.length ? personaFlops.slice(0, 8).map(fmt).join("\n") : "(none flagged)"}

TOP-PERFORMING HOOKS from OTHER personas that ${persona} has NOT yet tried (great source for either strategy: cross-pollinate top hits as exploit, or invert/twist as explore):
${crossPersonaHooks.length ? crossPersonaHooks.slice(0, 8).map(fmt).join("\n") : "(none available)"}

FATIGUED FAMILIES to AVOID (in cooldown — do NOT propose hooks similar to these; pick a different angle entirely):
${fatigueSection}

UNDER-EXPLORED CATEGORIES for ${persona} (preferred targets for explore hooks — fewer posts = open territory):
${nudgeSection}

Balance:
- Exploit hooks (${exploitCount}): each must clearly riff on a specific top-performing pattern. Reference the postId(s) you adapted in inspiredBy. Strategy = "exploit".
- Explore hooks (${exploreCount}): pick angles ${persona} hasn't tried in the last 30 days. Prefer under-explored categories listed above. inspiredBy may be empty. Strategy = "explore".
- None of the ${count} hooks should be semantically similar to a fatigued family.
- Hooks must be distinct from each other.`;

  const raw = await callClaude({
    model: OPUS,
    system: sys,
    content: [{ type: "text", text: user }],
    maxTokens: 1800,
  });
  const parsed = firstJson(raw) as { hooks?: Array<Partial<GenerationSuggestion>> };
  const hooks = Array.isArray(parsed?.hooks) ? parsed.hooks : [];
  const normalized: GenerationSuggestion[] = hooks
    .filter(
      (h): h is Partial<GenerationSuggestion> & { hook: string } =>
        !!h && typeof h.hook === "string" && h.hook.trim().length > 0,
    )
    .map((h) => ({
      hook: h.hook.trim(),
      category: isHookCategory(h.category) ? h.category : "other",
      rationale: typeof h.rationale === "string" ? h.rationale : "",
      inspiredBy: Array.isArray(h.inspiredBy)
        ? h.inspiredBy.filter((x): x is string => typeof x === "string")
        : [],
      strategy: (h.strategy === "explore" ? "explore" : "exploit") as HookStrategy,
    }))
    .slice(0, count);

  // Defensive rebalance: if Opus returned the wrong split, force the
  // earliest entries into the requested counts. Cheap and deterministic.
  let seenExploit = 0;
  let seenExplore = 0;
  for (const h of normalized) {
    if (h.strategy === "exploit") seenExploit++;
    else seenExplore++;
  }
  if (seenExploit !== exploitCount || seenExplore !== exploreCount) {
    let exploitLeft = exploitCount;
    for (const h of normalized) {
      if (exploitLeft > 0) {
        h.strategy = "exploit";
        exploitLeft--;
      } else {
        h.strategy = "explore";
      }
    }
  }
  return normalized;
}
