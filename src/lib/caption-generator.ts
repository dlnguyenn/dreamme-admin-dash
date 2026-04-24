import type { ModelId } from "./models";
import type { PersonaId } from "./personas";
import {
  INSTAGRAM_CHAR_CEILING,
  INSTAGRAM_CHAR_TARGET,
  buildInstagramCaptionPrompt,
  buildInstagramCompressPrompt,
  stripTrailingHashtags,
} from "./prompts/instagramCaption";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const API = "https://api.anthropic.com/v1/messages";
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 529]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MessageBlock {
  type: string;
  text?: string;
}

interface SystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export function captionGeneratorConfigured(): boolean {
  return !!ANTHROPIC_API_KEY;
}

async function callClaudeText(params: {
  model: ModelId;
  system: SystemBlock[];
  userText: string;
  maxTokens: number;
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
        max_tokens: params.maxTokens,
        system: params.system,
        messages: [
          { role: "user", content: [{ type: "text", text: params.userText }] },
        ],
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

function stripFences(s: string): string {
  const m = s.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
  return m ? m[1].trim() : s.trim();
}

function buildCachedSystem(styleGuide: string): SystemBlock[] {
  const text = `You are writing a TikTok caption for DreamMe, a GLP-1 community app. The style guide below is non-negotiable — follow every rule.

${styleGuide}

OUTPUT FORMAT:
- Return ONLY the caption text, starting with the hook line, ending with the CTA.
- No preamble, no commentary, no markdown code fences, no quotation marks around the caption.
- Target 3500 characters as specified in the style guide. HARD CEILING: 4000 characters — never exceed this under any circumstances.`;
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

export interface GenerateCaptionParams {
  hook: string;
  model: ModelId;
  notes?: string;
  avoidThemes?: string[];
  styleGuide: string;
}

export interface GenerateCaptionResult {
  caption: string;
  charCount: number;
}

export async function generateCaption(
  params: GenerateCaptionParams,
): Promise<GenerateCaptionResult> {
  const { hook, model, notes, avoidThemes, styleGuide } = params;

  const system = buildCachedSystem(styleGuide);

  const parts: string[] = [`HOOK (use exactly as the first line, lowercase):\n${hook}`];
  if (notes && notes.trim()) {
    parts.push(`ADDITIONAL NOTES / CONTEXT FROM THE EDITOR:\n${notes.trim()}`);
  }
  if (avoidThemes && avoidThemes.length) {
    parts.push(
      `ALREADY-USED TIP HEADERS — DO NOT REUSE THESE THEMES:\n${avoidThemes
        .map((t) => `- ${t}`)
        .join("\n")}`,
    );
  }
  parts.push(
    `Now write the full caption for this hook. Exactly 7-10 tips, each with 3 👉 sub-points, closing CTA. Target 3500 characters; hard ceiling 4000.`,
  );

  const raw = await callClaudeText({
    model,
    system,
    userText: parts.join("\n\n"),
    maxTokens: 4000,
  });

  const caption = stripFences(raw);
  return { caption, charCount: caption.length };
}

export interface CompressCaptionParams {
  oversizedCaption: string;
  model: ModelId;
  styleGuide: string;
}

export async function compressCaption(
  params: CompressCaptionParams,
): Promise<GenerateCaptionResult> {
  const { oversizedCaption, model, styleGuide } = params;

  const system = buildCachedSystem(styleGuide);

  const userText = `The caption below is over the 4000-character hard ceiling (${oversizedCaption.length} chars). Rewrite it to fit UNDER 3800 characters while preserving:
- The exact same hook (first line, lowercase, unchanged)
- Exactly 7-10 tips, each with ✅ header + one-line bridge + exactly 3 👉 sub-points
- Both DreamMe product mentions (same placement pattern)
- The closing CTA with "save this for later." + engagement question + 👇

Trim by shortening bridges and sub-points. Never drop a sub-point. Never drop a tip below 7. Never cut a DreamMe mention.

Return ONLY the rewritten caption — no preamble, no commentary, no fences.

CURRENT OVERSIZED CAPTION:
${oversizedCaption}`;

  const raw = await callClaudeText({
    model,
    system,
    userText,
    maxTokens: 4000,
  });

  const caption = stripFences(raw);
  return { caption, charCount: caption.length };
}

// ---------------------------------------------------------------------------
// Instagram caption generation
// ---------------------------------------------------------------------------

function buildInstagramSystem(): SystemBlock[] {
  const text = `You are writing an Instagram caption for DreamMe, a GLP-1 community app.

Instagram captions are sibling to TikTok captions — same seed hook, but a distinct voice. IG readers are scrolling a more intimate feed. Lean into short paragraphs, honest first-person beats, and breathing room. Avoid TikTok listicle formatting entirely.

OUTPUT FORMAT:
- Return ONLY the caption text — no preamble, no commentary, no markdown fences, no surrounding quotes.
- Never include hashtags. The creator adds their own.
- Target ${INSTAGRAM_CHAR_TARGET} characters. HARD CEILING: ${INSTAGRAM_CHAR_CEILING} characters — never exceed this under any circumstances.`;
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

export interface GenerateInstagramCaptionParams {
  hookText: string;
  personaId: PersonaId;
  model: ModelId;
  notes?: string;
}

export async function generateInstagramCaption(
  params: GenerateInstagramCaptionParams,
): Promise<GenerateCaptionResult> {
  const { hookText, personaId, model, notes } = params;
  const system = buildInstagramSystem();
  const userText = buildInstagramCaptionPrompt(hookText, personaId, notes);

  const raw = await callClaudeText({
    model,
    system,
    userText,
    // IG cap is 2000 chars; 1500 output tokens is plenty of headroom.
    maxTokens: 1500,
  });

  const caption = stripTrailingHashtags(stripFences(raw));
  return { caption, charCount: caption.length };
}

export interface CompressInstagramCaptionParams {
  oversizedCaption: string;
  personaId: PersonaId;
  model: ModelId;
}

export async function compressInstagramCaption(
  params: CompressInstagramCaptionParams,
): Promise<GenerateCaptionResult> {
  const { oversizedCaption, personaId, model } = params;
  const system = buildInstagramSystem();
  const userText = buildInstagramCompressPrompt(oversizedCaption, personaId);

  const raw = await callClaudeText({
    model,
    system,
    userText,
    maxTokens: 1500,
  });

  const caption = stripTrailingHashtags(stripFences(raw));
  return { caption, charCount: caption.length };
}
