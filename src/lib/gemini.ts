import { logAiUsageEvent } from "./vendors/ai-usage-logger";
import { priceGeminiUsage } from "./vendors/gemini-pricing";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";
const MODEL =
  process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image-preview";
const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 529]);

export function geminiConfigured() {
  return !!GOOGLE_API_KEY;
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
