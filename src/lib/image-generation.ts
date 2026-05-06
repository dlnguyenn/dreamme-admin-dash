/**
 * Server-only helper that drives a Gemini text-to-image generation, uploads
 * the result to the public `mcp-image-generations` Supabase bucket, records
 * a row in `image_generations`, and returns the public URL.
 *
 * Used by both:
 *   - `/api/mcp/image` — the self-hosted MCP server (claude.ai connector)
 *   - `/api/image-studio/generate` — the in-dash Image Studio panel
 *
 * Rate limit: 100 generations / 24h and 20 / hour, enforced via row-count
 * queries on `image_generations.created_at`. Counts are global (no per-user
 * identity in this dash) and apply to both the dash and the MCP endpoint.
 */
import { uploadBytesToStorage } from "./storage";
import { logAiUsageEvent } from "./vendors/ai-usage-logger";
import { priceGeminiUsage } from "./vendors/gemini-pricing";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";
const MODEL = "gemini-3.1-flash-image-preview";
const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const BUCKET = "mcp-image-generations";

const HOURLY_LIMIT = Number(process.env.MCP_IMAGE_HOURLY_LIMIT ?? 20);
const DAILY_LIMIT = Number(process.env.MCP_IMAGE_DAILY_LIMIT ?? 100);

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 529]);

export const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly window: "hour" | "day",
    public readonly limit: number,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export function imageGenerationConfigured(): boolean {
  return !!GOOGLE_API_KEY && !!SUPABASE_URL && !!SERVICE_ROLE;
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
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Part[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function checkRateLimit(count: number): Promise<void> {
  // Use the service-role REST endpoint with a HEAD-style count query.
  const headers = {
    apikey: SERVICE_ROLE || SUPABASE_ANON,
    Authorization: `Bearer ${SERVICE_ROLE || SUPABASE_ANON}`,
    Prefer: "count=exact",
    Range: "0-0",
  };
  const now = Date.now();
  const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  async function countSince(iso: string): Promise<number> {
    const url = `${SUPABASE_URL}/rest/v1/image_generations?select=id&created_at=gte.${encodeURIComponent(iso)}`;
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) {
      // Fail-open on infra error rather than blocking generations.
      return 0;
    }
    const range = res.headers.get("content-range") ?? "";
    // Format: "0-0/<count>" or "*/0"
    const match = /\/(\d+)$/.exec(range);
    return match ? Number(match[1]) : 0;
  }

  const [hourCount, dayCount] = await Promise.all([
    countSince(hourAgo),
    countSince(dayAgo),
  ]);
  if (hourCount + count > HOURLY_LIMIT) {
    throw new RateLimitError(
      `Hourly limit reached (${HOURLY_LIMIT}/hour). Try again later.`,
      "hour",
      HOURLY_LIMIT,
    );
  }
  if (dayCount + count > DAILY_LIMIT) {
    throw new RateLimitError(
      `Daily limit reached (${DAILY_LIMIT}/day). Try again tomorrow.`,
      "day",
      DAILY_LIMIT,
    );
  }
}

const REFERENCE_FETCH_TIMEOUT_MS = 10_000;
const REFERENCE_MAX_BYTES = 8 * 1024 * 1024;
const REFERENCE_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

interface ReferenceImage {
  bytes: Buffer;
  mimeType: string;
}

async function fetchReferenceImage(url: string): Promise<ReferenceImage> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid reference image URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Reference image URL must be http(s); got ${parsed.protocol}`,
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFERENCE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(
        `Reference image fetch failed (${res.status}) for ${url}`,
      );
    }
    const contentType = (res.headers.get("content-type") ?? "image/jpeg")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!REFERENCE_ALLOWED_MIME.has(contentType)) {
      throw new Error(
        `Reference image has unsupported content-type: ${contentType}`,
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > REFERENCE_MAX_BYTES) {
      throw new Error(
        `Reference image exceeds ${REFERENCE_MAX_BYTES} bytes`,
      );
    }
    return {
      bytes: Buffer.from(arrayBuffer),
      mimeType: contentType === "image/jpg" ? "image/jpeg" : contentType,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(
  prompt: string,
  aspectRatio: AspectRatio | undefined,
  referenceImages: ReferenceImage[],
  signal: AbortSignal,
): Promise<{ bytes: Buffer; mimeType: string; usage: GeminiResponse["usageMetadata"] }> {
  const parts: Part[] = [];
  for (const ref of referenceImages) {
    parts.push({
      inline_data: {
        mime_type: ref.mimeType,
        data: ref.bytes.toString("base64"),
      },
    });
  }
  parts.push({ text: prompt });
  const body: Record<string, unknown> = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
    },
  };
  const maxRetries = 3;
  let attempt = 0;
  while (true) {
    let res: Response;
    try {
      res = await fetch(ENDPOINT(MODEL), {
        method: "POST",
        headers: {
          "x-goog-api-key": GOOGLE_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (attempt < maxRetries) {
        await sleep(Math.min(16_000, 500 * Math.pow(2, attempt)));
        attempt++;
        continue;
      }
      throw err as Error;
    }
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
            bytes: Buffer.from(inline.data, "base64"),
            mimeType: inline.mimeType ?? inline.mime_type ?? "image/png",
            usage: data.usageMetadata,
          };
        }
      }
      const textFallback = parts.map((p) => p.text ?? "").join(" ").trim();
      throw new Error(
        textFallback
          ? `Gemini returned no image — ${textFallback.slice(0, 200)}`
          : "Gemini returned no image — the prompt may have been filtered.",
      );
    }
    const text = await res.text();
    if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
      throw new Error(`Gemini error: ${res.status} ${text}`);
    }
    await sleep(Math.min(16_000, 500 * Math.pow(2, attempt)));
    attempt++;
  }
}

function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  return "png";
}

function randomId(): string {
  // Crypto.randomUUID is available in Node 20+. Fallback for safety.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function insertRow(row: {
  prompt: string;
  aspect_ratio: string | null;
  image_url: string;
  gemini_model: string;
  source: "mcp" | "dashboard";
  reference_urls: string[] | null;
}): Promise<{ id: string; created_at: string }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/image_generations`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE || SUPABASE_ANON,
      Authorization: `Bearer ${SERVICE_ROLE || SUPABASE_ANON}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(
      `image_generations insert failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = await res.json();
  const r = Array.isArray(data) ? data[0] : data;
  return { id: r.id, created_at: r.created_at };
}

export interface GenerateImageResult {
  id: string;
  imageUrl: string;
  prompt: string;
  aspectRatio: AspectRatio | null;
  geminiModel: string;
  createdAt: string;
  referenceImageUrl: string | null;
}

export async function generateImage(params: {
  prompt: string;
  aspectRatio?: AspectRatio;
  /** Optional public http(s) URL of a reference image (image-to-image mode). */
  referenceImageUrl?: string;
  /** Optional inline base64-encoded reference image (alternative to referenceImageUrl). */
  referenceImageBase64?: string;
  /** mimeType for referenceImageBase64. Defaults to "image/png". */
  referenceImageMimeType?: string;
  source: "mcp" | "dashboard";
  /** Per-attempt timeout in ms. Default 60s — Gemini image gen is usually 5-25s. */
  timeoutMs?: number;
}): Promise<GenerateImageResult> {
  if (!imageGenerationConfigured()) {
    throw new Error(
      "image generation not configured (missing GOOGLE_API_KEY or Supabase env)",
    );
  }
  const prompt = params.prompt.trim();
  if (!prompt) throw new Error("prompt is required");

  await checkRateLimit(1);

  const referenceImages: ReferenceImage[] = [];
  if (params.referenceImageUrl) {
    referenceImages.push(await fetchReferenceImage(params.referenceImageUrl));
  } else if (params.referenceImageBase64) {
    const mime = (params.referenceImageMimeType ?? "image/png").toLowerCase();
    if (!REFERENCE_ALLOWED_MIME.has(mime)) {
      throw new Error(`Reference image mime not supported: ${mime}`);
    }
    const bytes = Buffer.from(params.referenceImageBase64, "base64");
    if (bytes.length > REFERENCE_MAX_BYTES) {
      throw new Error(`Reference image exceeds ${REFERENCE_MAX_BYTES} bytes`);
    }
    referenceImages.push({
      bytes,
      mimeType: mime === "image/jpg" ? "image/jpeg" : mime,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    params.timeoutMs ?? 60_000,
  );

  let gen: Awaited<ReturnType<typeof callGemini>>;
  try {
    gen = await callGemini(
      prompt,
      params.aspectRatio,
      referenceImages,
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
  }

  const ext = extFromMime(gen.mimeType);
  const id = randomId();
  const path = `${id}.${ext}`;
  const imageUrl = await uploadBytesToStorage(
    BUCKET,
    path,
    gen.bytes,
    gen.mimeType,
  );

  const refUrl = params.referenceImageUrl ?? null;
  const inserted = await insertRow({
    prompt,
    aspect_ratio: params.aspectRatio ?? null,
    image_url: imageUrl,
    gemini_model: MODEL,
    source: params.source,
    reference_urls: refUrl ? [refUrl] : null,
  });

  const usage = gen.usage ?? {};
  void logAiUsageEvent({
    vendor: "google",
    model: MODEL,
    route: params.source === "mcp" ? "/api/mcp/image" : "/api/image-studio/generate",
    inputTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
    imageCount: 1,
    computedUsd: priceGeminiUsage({
      model: MODEL,
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
      imageCount: 1,
    }),
    metadata: {
      source: params.source,
      has_reference: referenceImages.length > 0,
    },
  });

  return {
    id: inserted.id,
    imageUrl,
    prompt,
    aspectRatio: params.aspectRatio ?? null,
    geminiModel: MODEL,
    createdAt: inserted.created_at,
    referenceImageUrl: refUrl,
  };
}

export interface ImageGenerationRow {
  id: string;
  prompt: string;
  aspect_ratio: string | null;
  image_url: string;
  gemini_model: string | null;
  source: string | null;
  created_at: string;
  reference_urls: string[] | null;
}

export async function listImageGenerations(params: {
  limit?: number;
  offset?: number;
}): Promise<ImageGenerationRow[]> {
  const limit = Math.min(Math.max(params.limit ?? 24, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);
  const url = `${SUPABASE_URL}/rest/v1/image_generations?select=id,prompt,aspect_ratio,image_url,gemini_model,source,created_at,reference_urls&order=created_at.desc&limit=${limit}&offset=${offset}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE || SUPABASE_ANON,
      Authorization: `Bearer ${SERVICE_ROLE || SUPABASE_ANON}`,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `image_generations read failed: ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}
