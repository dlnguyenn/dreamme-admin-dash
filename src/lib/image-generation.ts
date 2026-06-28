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
import { extractStoragePath, storageDelete, uploadBytesToStorage } from "./storage";
import { logAiUsageEvent } from "./vendors/ai-usage-logger";
import { priceGeminiUsage } from "./vendors/gemini-pricing";

export const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY ?? "";
export const MODEL = "gemini-3.1-flash-image-preview";
const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SERVICE_ROLE =
  (process.env.DM_INTERNAL_SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY) ??
  "";
export const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const BUCKET = "mcp-image-generations";

const HOURLY_LIMIT = Number(process.env.MCP_IMAGE_HOURLY_LIMIT ?? 150);
const DAILY_LIMIT = Number(process.env.MCP_IMAGE_DAILY_LIMIT ?? 500);

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

export async function checkRateLimit(count: number): Promise<void> {
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
    // Cap at 8s so a stuck Supabase fetch can't eat the client's
    // tool-call budget. Fail-open on timeout (treat as "no rows").
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(url, {
        headers,
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) {
        // Fail-open on infra error rather than blocking generations.
        return 0;
      }
      const range = res.headers.get("content-range") ?? "";
      // Format: "0-0/<count>" or "*/0"
      const match = /\/(\d+)$/.exec(range);
      return match ? Number(match[1]) : 0;
    } catch {
      // Fail-open on timeout / network error.
      return 0;
    } finally {
      clearTimeout(timer);
    }
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

const REFERENCE_FETCH_TIMEOUT_MS = 20_000;
const REFERENCE_FETCH_MAX_RETRIES = 1;
export const REFERENCE_MAX_BYTES = 8 * 1024 * 1024;
export const REFERENCE_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

/**
 * The semantic role of a reference image. Used to interleave a labeling
 * text part directly before the image in the Gemini request so the model
 * knows which image is the face vs the pose. "plain" (or undefined) emits
 * no label — the image is sent bare (legacy behavior for n8n/MCP refs).
 */
export type RefRole = "identity" | "pose" | "plain";

export interface ReferenceImage {
  bytes: Buffer;
  mimeType: string;
  role?: RefRole;
}

/**
 * A single reference image input: either a public URL or inline base64
 * (+ mimeType), with an optional semantic role. Used in array form to
 * attach multiple references to one generation. Shared across the
 * dashboard routes, the MCP tools, and the batch path.
 */
export interface RefInput {
  url?: string;
  base64?: string;
  mimeType?: string;
  role?: RefRole;
}

/** Hard cap on reference images per generation. */
export const MAX_REFERENCE_IMAGES = 4;

/**
 * Label text emitted immediately before a reference image in the Gemini
 * `parts` array, so the model binds each image to its role by adjacency.
 * "plain"/undefined returns null → no label (image sent bare).
 */
const REF_ROLE_LABELS: Partial<Record<RefRole, string>> = {
  identity:
    "IDENTITY reference — use this person's face and identity in the generated image:",
  pose: "POSE reference — match this image's body pose, framing, and composition; do NOT take facial identity or clothing from this image:",
};

export function refRoleLabel(role?: RefRole): string | null {
  return (role && REF_ROLE_LABELS[role]) || null;
}

/** Decode + validate one base64 reference into a ReferenceImage. */
export function decodeBase64Reference(
  base64: string,
  mimeType?: string,
): ReferenceImage {
  const mime = (mimeType ?? "image/png").toLowerCase();
  if (!REFERENCE_ALLOWED_MIME.has(mime)) {
    throw new Error(`Reference image mime not supported: ${mime}`);
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length > REFERENCE_MAX_BYTES) {
    throw new Error(`Reference image exceeds ${REFERENCE_MAX_BYTES} bytes`);
  }
  return { bytes, mimeType: mime === "image/jpg" ? "image/jpeg" : mime };
}

/**
 * Normalize reference inputs into fetched/decoded ReferenceImage[] plus the
 * list of url-type references (for `reference_urls` provenance). Prefers the
 * array form; falls back to the legacy single-field params so existing
 * callers (n8n, older MCP requests) keep working. Capped at
 * MAX_REFERENCE_IMAGES.
 */
export async function resolveReferenceImages(params: {
  referenceImages?: RefInput[];
  referenceImageUrl?: string;
  referenceImageBase64?: string;
  referenceImageMimeType?: string;
}): Promise<{ images: ReferenceImage[]; urls: string[] }> {
  let inputs: RefInput[] = [];
  if (params.referenceImages && params.referenceImages.length > 0) {
    inputs = params.referenceImages;
  } else if (params.referenceImageUrl) {
    inputs = [{ url: params.referenceImageUrl }];
  } else if (params.referenceImageBase64) {
    inputs = [
      {
        base64: params.referenceImageBase64,
        mimeType: params.referenceImageMimeType,
      },
    ];
  }
  if (inputs.length > MAX_REFERENCE_IMAGES) {
    throw new Error(
      `Too many reference images (max ${MAX_REFERENCE_IMAGES}, got ${inputs.length})`,
    );
  }
  const images: ReferenceImage[] = [];
  const urls: string[] = [];
  for (const ref of inputs) {
    if (ref.url) {
      const img = await fetchReferenceImage(ref.url);
      img.role = ref.role;
      images.push(img);
      urls.push(ref.url);
    } else if (ref.base64) {
      const img = decodeBase64Reference(ref.base64, ref.mimeType);
      img.role = ref.role;
      images.push(img);
    }
  }
  return { images, urls };
}

export async function fetchReferenceImage(url: string): Promise<ReferenceImage> {
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

  // Try once, retry once on transient network/timeout errors. 4xx/5xx
  // and content-type / size errors are NOT retried — they're terminal.
  let lastErr: unknown;
  for (let attempt = 0; attempt <= REFERENCE_FETCH_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      REFERENCE_FETCH_TIMEOUT_MS,
    );
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
    } catch (err) {
      lastErr = err;
      // Only retry on AbortError (timeout) or generic network/fetch
      // failures. Non-retryable errors above already threw with a
      // specific message; identify them and break out.
      const message = (err as Error).message ?? "";
      const isTerminal =
        message.startsWith("Reference image fetch failed (") ||
        message.startsWith("Reference image has unsupported") ||
        message.startsWith("Reference image exceeds");
      if (isTerminal) throw err;
      // else fall through and retry
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Reference image fetch failed");
}

async function callGemini(
  prompt: string,
  aspectRatio: AspectRatio | undefined,
  referenceImages: ReferenceImage[],
  signal: AbortSignal,
): Promise<{ bytes: Buffer; mimeType: string; usage: GeminiResponse["usageMetadata"] }> {
  const parts: Part[] = [];
  for (const ref of referenceImages) {
    // Label roled references immediately before the image so the model
    // binds face-vs-pose by adjacency. Plain refs are sent bare.
    const label = refRoleLabel(ref.role);
    if (label) parts.push({ text: label });
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

export function extFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  return "png";
}

export function randomId(): string {
  // Crypto.randomUUID is available in Node 20+. Fallback for safety.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function insertRow(row: {
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
  /** First url-type reference, kept for back-compat with single-ref callers. */
  referenceImageUrl: string | null;
  /** All url-type references for this generation (base64 refs are inline-only). */
  referenceImageUrls: string[];
}

/**
 * Decide whether a Gemini call failure is worth retrying once. We
 * retry on the noise — timeouts, abort, 5xx, network hiccups — and
 * skip permanent classes (safety blocks, validation, auth) that
 * will fail the same way on a second pass.
 */
function isTransientGeminiError(err: unknown): boolean {
  if (!err) return false;
  const name = (err as Error)?.name?.toLowerCase() ?? "";
  const message = (err as Error)?.message?.toLowerCase() ?? "";
  if (!message && !name) return false;
  if (name === "aborterror") return true;
  // Skip known-permanent classifications even if they happen to
  // contain a transient-looking word.
  const permanentMarkers = [
    "blocked",
    "safety",
    "policy",
    "invalid_argument",
    "permission_denied",
    "unauthenticated",
    "not found",
  ];
  if (permanentMarkers.some((m) => message.includes(m))) return false;
  const transientMarkers = [
    "abort",
    "timeout",
    "timed out",
    "deadline",
    "fetch failed",
    "network",
    "econnreset",
    "econnrefused",
    "enotfound",
    "etimedout",
    "service unavailable",
    "bad gateway",
    "gateway timeout",
    "internal server error",
    "internal error",
    "unavailable",
    " 500",
    " 502",
    " 503",
    " 504",
  ];
  return transientMarkers.some((m) => message.includes(m));
}

export async function generateImage(params: {
  prompt: string;
  aspectRatio?: AspectRatio;
  /** Up to MAX_REFERENCE_IMAGES references (URL or inline base64). Preferred
   *  over the single-field params below; those remain for back-compat. */
  referenceImages?: RefInput[];
  /** Optional public http(s) URL of a reference image (image-to-image mode). */
  referenceImageUrl?: string;
  /** Optional inline base64-encoded reference image (alternative to referenceImageUrl). */
  referenceImageBase64?: string;
  /** mimeType for referenceImageBase64. Defaults to "image/png". */
  referenceImageMimeType?: string;
  source: "mcp" | "dashboard";
  /** Per-attempt timeout in ms. Default 60s — Gemini image gen is usually 5-25s. */
  timeoutMs?: number;
  /** Internal: skip the rate-limit check (used by batch mode where the
   *  caller already reserved budget for the whole batch). */
  _skipRateLimit?: boolean;
}): Promise<GenerateImageResult> {
  if (!imageGenerationConfigured()) {
    throw new Error(
      "image generation not configured (missing GOOGLE_API_KEY or Supabase env)",
    );
  }
  const prompt = params.prompt.trim();
  if (!prompt) throw new Error("prompt is required");

  if (!params._skipRateLimit) {
    await checkRateLimit(1);
  }

  const { images: referenceImages, urls: referenceUrls } =
    await resolveReferenceImages(params);

  // Auto-retry once on transient errors (timeouts, 5xx, network
  // hiccups, abort). n8n's image-gen workflows retry silently — we
  // bring Image Studio closer to that "always works" feel by giving
  // the obvious-noise failures a second pass before surfacing them.
  // Permanent failures (safety blocks, validation, auth) skip the
  // retry. Each attempt gets its own AbortController so the second
  // call isn't cancelled by the first attempt's already-fired timer.
  const totalTimeoutMs = params.timeoutMs ?? 60_000;
  const startedAt = Date.now();
  const runOnce = async (budgetMs: number) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budgetMs);
    try {
      return await callGemini(
        prompt,
        params.aspectRatio,
        referenceImages,
        controller.signal,
      );
    } finally {
      clearTimeout(timer);
    }
  };

  let gen: Awaited<ReturnType<typeof callGemini>>;
  try {
    gen = await runOnce(totalTimeoutMs);
  } catch (firstErr) {
    const elapsed = Date.now() - startedAt;
    const remainingMs = totalTimeoutMs - elapsed;
    const transient = isTransientGeminiError(firstErr);
    // Need at least 30 s of budget for a meaningful retry. Fast
    // fails (network errors that came back in 1-2 s) leave plenty;
    // a slow timeout that ate the whole budget skips retry and
    // surfaces the original error.
    if (transient && remainingMs >= 30_000) {
      const message =
        firstErr instanceof Error ? firstErr.message : String(firstErr);
      console.warn(
        `[image-gen] retrying after transient error (${message}); ${remainingMs} ms budget remaining`,
        { source: params.source },
      );
      gen = await runOnce(remainingMs);
    } else {
      throw firstErr;
    }
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

  const inserted = await insertRow({
    prompt,
    aspect_ratio: params.aspectRatio ?? null,
    image_url: imageUrl,
    gemini_model: MODEL,
    source: params.source,
    reference_urls: referenceUrls.length > 0 ? referenceUrls : null,
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
      reference_count: referenceImages.length,
    },
  });

  return {
    id: inserted.id,
    imageUrl,
    prompt,
    aspectRatio: params.aspectRatio ?? null,
    geminiModel: MODEL,
    createdAt: inserted.created_at,
    referenceImageUrl: referenceUrls[0] ?? null,
    referenceImageUrls: referenceUrls,
  };
}

export const MAX_BATCH_COUNT = 8;

export interface BatchItemError {
  index: number;
  error: string;
}

/**
 * Run `count` parallel `generateImage` calls with a shared rate-limit
 * budget. Yields completed results to `onProgress` as they land so the
 * caller can stream incremental updates over MCP notifications/progress.
 *
 * Failures don't abort siblings — `Promise.allSettled` collects every
 * outcome, fulfilled results land in `results[]`, rejected ones land
 * in `errors[]` along with the slot index. Each failure also gets a
 * `console.error` so Vercel function logs capture it. Callers decide
 * whether `results.length === 0 && errors.length > 0` is fatal (e.g.
 * the dashboard route returns 500 only when nothing succeeded).
 */
export async function generateImageBatch(params: {
  prompt: string;
  aspectRatio?: AspectRatio;
  referenceImages?: RefInput[];
  referenceImageUrl?: string;
  referenceImageBase64?: string;
  referenceImageMimeType?: string;
  source: "mcp" | "dashboard";
  count: number;
  timeoutMs?: number;
  onProgress?: (completed: number, total: number) => void;
}): Promise<{
  results: GenerateImageResult[];
  errors: BatchItemError[];
}> {
  const { count } = params;
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH_COUNT) {
    throw new Error(`count must be an integer between 1 and ${MAX_BATCH_COUNT}`);
  }
  await checkRateLimit(count);

  let completed = 0;
  const settled = await Promise.allSettled(
    Array.from({ length: count }, () =>
      generateImage({
        prompt: params.prompt,
        aspectRatio: params.aspectRatio,
        referenceImages: params.referenceImages,
        referenceImageUrl: params.referenceImageUrl,
        referenceImageBase64: params.referenceImageBase64,
        referenceImageMimeType: params.referenceImageMimeType,
        source: params.source,
        timeoutMs: params.timeoutMs,
        _skipRateLimit: true,
      }),
    ),
  );

  const results: GenerateImageResult[] = [];
  const errors: BatchItemError[] = [];
  const promptSnippet = params.prompt.slice(0, 80);
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") {
      results.push(s.value);
      completed += 1;
      params.onProgress?.(completed, count);
    } else {
      const message =
        (s.reason instanceof Error
          ? s.reason.message
          : typeof s.reason === "string"
            ? s.reason
            : null) ?? "unknown error";
      console.error(
        `[image-gen] sync item ${i + 1}/${count} failed: ${message}`,
        { promptSnippet, source: params.source },
      );
      errors.push({ index: i, error: message });
    }
  }
  return { results, errors };
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

/**
 * Delete one or more image_generations rows along with their storage
 * blobs in the `mcp-image-generations` bucket. Storage delete is
 * best-effort — orphaned blobs are tolerated. The DB delete is the
 * source of truth for what shows up in the gallery, so we surface
 * errors from that step but swallow storage failures.
 */
export async function deleteImageGenerations(
  ids: string[],
): Promise<{ deleted: number }> {
  if (ids.length === 0) return { deleted: 0 };
  const idList = ids.map((id) => encodeURIComponent(id)).join(",");
  const readUrl = `${SUPABASE_URL}/rest/v1/image_generations?select=id,image_url&id=in.(${idList})`;
  const readRes = await fetch(readUrl, {
    headers: {
      apikey: SERVICE_ROLE || SUPABASE_ANON,
      Authorization: `Bearer ${SERVICE_ROLE || SUPABASE_ANON}`,
    },
    cache: "no-store",
  });
  if (!readRes.ok) {
    throw new Error(
      `image_generations read failed: ${readRes.status} ${await readRes.text()}`,
    );
  }
  const rows = (await readRes.json()) as Array<{ id: string; image_url: string }>;

  await Promise.all(
    rows.map(async (r) => {
      const path = extractStoragePath(r.image_url, BUCKET);
      if (path) await storageDelete(path, BUCKET);
    }),
  );

  const deleteUrl = `${SUPABASE_URL}/rest/v1/image_generations?id=in.(${idList})`;
  const delRes = await fetch(deleteUrl, {
    method: "DELETE",
    headers: {
      apikey: SERVICE_ROLE || SUPABASE_ANON,
      Authorization: `Bearer ${SERVICE_ROLE || SUPABASE_ANON}`,
      Prefer: "return=representation",
    },
  });
  if (!delRes.ok) {
    throw new Error(
      `image_generations delete failed: ${delRes.status} ${await delRes.text()}`,
    );
  }
  const deleted = (await delRes.json()) as Array<{ id: string }>;
  return { deleted: deleted.length };
}
