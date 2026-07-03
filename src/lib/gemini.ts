import { logAiUsageEvent } from "./vendors/ai-usage-logger";
import { priceGeminiUsage } from "./vendors/gemini-pricing";

// Lazy env reads — top-level constants capture process.env before
// loadEnvConfig runs in CLI scripts (ESM imports hoist).
const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 529]);

function getApiKey(): string {
  return process.env.GOOGLE_API_KEY ?? "";
}
function getModel(): string {
  return process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image-preview";
}
function getVideoModel(): string {
  // gemini-3.5-flash is the newest full-flash tier with video understanding
  // (verified against the live models list 2026-07; there is no plain
  // "gemini-3.1-flash" — only -lite and -image variants of 3.1).
  return process.env.GEMINI_VIDEO_MODEL ?? "gemini-3.5-flash";
}

export function geminiConfigured() {
  return !!getApiKey();
}

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

interface InlineData {
  mimeType?: string;
  mime_type?: string;
  data: string;
}
interface Part {
  text?: string;
  inlineData?: InlineData;
  inline_data?: InlineData;
}
interface Candidate {
  content?: { parts?: Part[] };
  finishReason?: string;
}
interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}
interface GeminiResponse {
  candidates?: Candidate[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: UsageMetadata;
}

export async function editImage(params: {
  imageBytes: Buffer;
  mimeType: string;
  prompt: string;
  maxRetries?: number;
  /**
   * Per-attempt timeout in ms. Prevents a single stalled Gemini call from
   * blocking the whole serverless function past Vercel's 60s cap. Defaults
   * to 45s — lots of headroom for normal image-edit latency (15-25s) while
   * still killing pathological hangs. Callers on tight deadlines (e.g.,
   * two parallel calls within a 60s budget) should pass a smaller value.
   */
  timeoutMs?: number;
  /**
   * Free-form route tag attached to spend events (e.g.
   * "/api/modify/image"). Used to attribute Gemini cost back to the
   * surface that triggered it.
   */
  route?: string;
}): Promise<{ imageBase64: string; mimeType: string }> {
  const GOOGLE_API_KEY = getApiKey();
  const MODEL = getModel();
  if (!GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY not set");
  const maxRetries = params.maxRetries ?? 3;
  const timeoutMs = params.timeoutMs ?? 45_000;
  const body = {
    contents: [
      {
        parts: [
          { text: params.prompt },
          {
            inline_data: {
              mime_type: params.mimeType,
              data: params.imageBytes.toString("base64"),
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };

  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(ENDPOINT(MODEL), {
        method: "POST",
        headers: {
          "x-goog-api-key": GOOGLE_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted =
        (err as Error)?.name === "AbortError" ||
        /abort/i.test((err as Error)?.message ?? "");
      if (aborted && attempt < maxRetries) {
        // Treat a timeout like a retryable network blip.
        const backoff = Math.min(16_000, 500 * Math.pow(2, attempt));
        const jitter = Math.floor(Math.random() * 250);
        await sleep(backoff + jitter);
        attempt++;
        continue;
      }
      throw aborted
        ? new Error(`Gemini timed out after ${timeoutMs}ms`)
        : (err as Error);
    }
    clearTimeout(timer);

    if (res.ok) {
      const data = (await res.json()) as GeminiResponse;
      const block = data.promptFeedback?.blockReason;
      if (block) {
        throw new Error(
          `Gemini blocked the prompt (${block}). Try different wording.`,
        );
      }
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      for (const p of parts) {
        const inline = p.inlineData ?? p.inline_data;
        if (inline?.data) {
          const usage = data.usageMetadata ?? {};
          const inputTokens = usage.promptTokenCount ?? 0;
          const outputTokens = usage.candidatesTokenCount ?? 0;
          void logAiUsageEvent({
            vendor: "google",
            model: MODEL,
            route: params.route,
            inputTokens,
            outputTokens,
            imageCount: 1,
            computedUsd: priceGeminiUsage({
              model: MODEL,
              inputTokens,
              outputTokens,
              imageCount: 1,
            }),
            metadata: { attempt },
          });
          return {
            imageBase64: inline.data,
            mimeType: inline.mimeType ?? inline.mime_type ?? "image/png",
          };
        }
      }
      const textFallback = parts
        .map((p) => p.text ?? "")
        .join(" ")
        .trim();
      throw new Error(
        textFallback
          ? `Gemini returned no image — ${textFallback.slice(0, 200)}`
          : "Gemini returned no image — the prompt may have been filtered.",
      );
    }

    const bodyText = await res.text();
    const retryable = RETRYABLE_STATUSES.has(res.status);
    if (!retryable || attempt >= maxRetries) {
      throw new Error(`Gemini error: ${res.status} ${bodyText}`);
    }
    const backoff = Math.min(16_000, 500 * Math.pow(2, attempt));
    const jitter = Math.floor(Math.random() * 250);
    await sleep(backoff + jitter);
    attempt++;
  }
}

/** Inline-video cap: Gemini accepts ~20MB request bodies; base64 inflates
 *  by 4/3, so cap the raw file a bit under. TikTok SD files run 2-10MB. */
export const VIDEO_INLINE_MAX_BYTES = 14 * 1024 * 1024;

/**
 * Watch a short video and answer a prompt about it. Fetches the bytes
 * server-side (social CDN URLs expire fast — call this immediately after
 * scraping) and sends them inline as base64. Throws on fetch failure or
 * oversize files so callers can fall back to cover-frame coding.
 */
export async function analyzeVideo(params: {
  videoUrl: string;
  prompt: string;
  mimeType?: string;
  timeoutMs?: number;
  route?: string;
}): Promise<{ text: string }> {
  const GOOGLE_API_KEY = getApiKey();
  const MODEL = getVideoModel();
  if (!GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY not set");
  const timeoutMs = params.timeoutMs ?? 90_000;

  const videoRes = await fetch(params.videoUrl, {
    headers: { "User-Agent": "dreamme-admin-dash/1.0" },
  });
  if (!videoRes.ok) {
    throw new Error(`video fetch failed: ${videoRes.status}`);
  }
  const buf = Buffer.from(await videoRes.arrayBuffer());
  if (buf.byteLength === 0) throw new Error("video fetch returned 0 bytes");
  if (buf.byteLength > VIDEO_INLINE_MAX_BYTES) {
    throw new Error(
      `video too large for inline analysis (${Math.round(buf.byteLength / 1024 / 1024)}MB > ${Math.round(VIDEO_INLINE_MAX_BYTES / 1024 / 1024)}MB)`,
    );
  }
  const mime =
    params.mimeType ??
    videoRes.headers.get("content-type")?.split(";")[0] ??
    "video/mp4";

  const body = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: mime.startsWith("video/") ? mime : "video/mp4",
              data: buf.toString("base64"),
            },
          },
          { text: params.prompt },
        ],
      },
    ],
  };

  let attempt = 0;
  const maxRetries = 2;
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(ENDPOINT(MODEL), {
        method: "POST",
        headers: {
          "x-goog-api-key": GOOGLE_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted =
        (err as Error)?.name === "AbortError" ||
        /abort/i.test((err as Error)?.message ?? "");
      if (aborted && attempt < maxRetries) {
        await sleep(Math.min(16_000, 1000 * Math.pow(2, attempt)));
        attempt++;
        continue;
      }
      throw aborted
        ? new Error(`Gemini video call timed out after ${timeoutMs}ms`)
        : (err as Error);
    }
    clearTimeout(timer);

    if (res.ok) {
      const data = (await res.json()) as GeminiResponse;
      const block = data.promptFeedback?.blockReason;
      if (block) throw new Error(`Gemini blocked the video prompt (${block}).`);
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      if (!text) throw new Error("Gemini returned no text for the video");
      const usage = data.usageMetadata ?? {};
      const inputTokens = usage.promptTokenCount ?? 0;
      const outputTokens = usage.candidatesTokenCount ?? 0;
      void logAiUsageEvent({
        vendor: "google",
        model: MODEL,
        route: params.route,
        inputTokens,
        outputTokens,
        imageCount: 0,
        computedUsd: priceGeminiUsage({
          model: MODEL,
          inputTokens,
          outputTokens,
          imageCount: 0,
        }),
        metadata: { attempt, video_bytes: buf.byteLength },
      });
      return { text };
    }

    const bodyText = await res.text();
    if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
      throw new Error(`Gemini video error: ${res.status} ${bodyText.slice(0, 300)}`);
    }
    await sleep(Math.min(16_000, 1000 * Math.pow(2, attempt)));
    attempt++;
  }
}
