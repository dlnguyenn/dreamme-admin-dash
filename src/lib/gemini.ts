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
interface GeminiResponse {
  candidates?: Candidate[];
  promptFeedback?: { blockReason?: string };
}

export async function editImage(params: {
  imageBytes: Buffer;
  mimeType: string;
  prompt: string;
  maxRetries?: number;
}): Promise<{ imageBase64: string; mimeType: string }> {
  if (!GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY not set");
  const maxRetries = params.maxRetries ?? 3;
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
    const res = await fetch(ENDPOINT(MODEL), {
      method: "POST",
      headers: {
        "x-goog-api-key": GOOGLE_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

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
