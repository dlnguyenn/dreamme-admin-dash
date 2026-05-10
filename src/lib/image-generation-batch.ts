/**
 * Async Gemini Batch image generation.
 *
 * Wraps Gemini's `:batchGenerateContent` endpoint, which discounts 50%
 * vs synchronous in exchange for async turnaround (24h SLA, typically
 * 2-6h). Each submission is persisted in `image_generation_batches`
 * (see migration 0022). Polling is lazy — `getImageBatch` queries
 * Gemini only when the local row's status is non-terminal, then
 * downloads + uploads any new outputs and inserts one
 * `image_generations` row per output for gallery surfacing.
 *
 * Synchronous `generate_image` (`generateImage` / `generateImageBatch`
 * in `image-generation.ts`) is unchanged.
 */
import { uploadBytesToStorage } from "./storage";
import { logAiUsageEvent } from "./vendors/ai-usage-logger";
import { priceGeminiUsage } from "./vendors/gemini-pricing";
import {
  ASPECT_RATIOS,
  BUCKET,
  GOOGLE_API_KEY,
  MODEL,
  REFERENCE_ALLOWED_MIME,
  REFERENCE_MAX_BYTES,
  SERVICE_ROLE,
  SUPABASE_ANON,
  SUPABASE_URL,
  type AspectRatio,
  type ReferenceImage,
  checkRateLimit,
  extFromMime,
  fetchReferenceImage,
  imageGenerationConfigured,
  insertRow,
  randomId,
} from "./image-generation";

export const MAX_BATCH_ITEMS = 100;

const BATCH_ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchGenerateContent`;
const BATCH_GET = (name: string) =>
  // `name` is e.g. "batches/abc123" — Google's resource path.
  `https://generativelanguage.googleapis.com/v1beta/${name}`;

export type BatchStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export interface BatchItemInput {
  prompt: string;
  aspectRatio?: AspectRatio;
  referenceImageUrl?: string;
  referenceImageBase64?: string;
  referenceImageMimeType?: string;
}

export interface BatchItemResult {
  prompt: string;
  imageUrl?: string;
  imageGenerationId?: string;
  error?: string;
}

export interface ImageBatchSummary {
  batchId: string;
  geminiBatchName: string;
  status: BatchStatus;
  itemCount: number;
  geminiModel: string;
  submittedAt: string;
  completedAt: string | null;
  items: BatchItemInput[];
  results: BatchItemResult[] | null;
  error: string | null;
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

/**
 * Gemini's `Operation`-style response. We only read the fields that
 * matter for us; everything else is opaque metadata.
 */
interface GeminiBatchOperation {
  name: string;
  done?: boolean;
  metadata?: {
    state?: string;
    "@type"?: string;
  };
  response?: {
    "@type"?: string;
    inlinedResponses?: {
      inlinedResponses?: Array<{
        response?: {
          candidates?: Array<{ content?: { parts?: Part[] } }>;
          promptFeedback?: { blockReason?: string };
        };
        error?: { code?: number; message?: string };
      }>;
    };
  };
  error?: { code?: number; message?: string };
}

function supabaseHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_ROLE || SUPABASE_ANON,
    Authorization: `Bearer ${SERVICE_ROLE || SUPABASE_ANON}`,
    "Content-Type": "application/json",
  };
}

function mapGeminiState(state: string | undefined): BatchStatus {
  // Gemini emits enums like BATCH_STATE_PENDING / _RUNNING / _SUCCEEDED /
  // _FAILED / _CANCELLED. Normalize to our shorter form.
  if (!state) return "PENDING";
  const s = state.replace(/^BATCH_STATE_/, "").toUpperCase();
  if (s === "PENDING" || s === "RUNNING" || s === "SUCCEEDED" ||
      s === "FAILED" || s === "CANCELLED") {
    return s;
  }
  return "PENDING";
}

async function decodeReference(
  item: BatchItemInput,
): Promise<ReferenceImage | undefined> {
  if (item.referenceImageUrl) {
    return fetchReferenceImage(item.referenceImageUrl);
  }
  if (item.referenceImageBase64) {
    const mime = (item.referenceImageMimeType ?? "image/png").toLowerCase();
    if (!REFERENCE_ALLOWED_MIME.has(mime)) {
      throw new Error(`Reference image mime not supported: ${mime}`);
    }
    const bytes = Buffer.from(item.referenceImageBase64, "base64");
    if (bytes.length > REFERENCE_MAX_BYTES) {
      throw new Error(`Reference image exceeds ${REFERENCE_MAX_BYTES} bytes`);
    }
    return {
      bytes,
      mimeType: mime === "image/jpg" ? "image/jpeg" : mime,
    };
  }
  return undefined;
}

function buildRequestParts(prompt: string, ref?: ReferenceImage): Part[] {
  const parts: Part[] = [];
  if (ref) {
    parts.push({
      inline_data: {
        mime_type: ref.mimeType,
        data: ref.bytes.toString("base64"),
      },
    });
  }
  parts.push({ text: prompt });
  return parts;
}

export async function submitImageBatch(params: {
  items: BatchItemInput[];
  source: "mcp" | "dashboard";
  displayName?: string;
}): Promise<ImageBatchSummary> {
  if (!imageGenerationConfigured()) {
    throw new Error(
      "image generation not configured (missing GOOGLE_API_KEY or Supabase env)",
    );
  }
  if (!params.items.length) {
    throw new Error("items must contain at least one entry");
  }
  if (params.items.length > MAX_BATCH_ITEMS) {
    throw new Error(`items must be at most ${MAX_BATCH_ITEMS} entries`);
  }
  for (const item of params.items) {
    if (typeof item.prompt !== "string" || !item.prompt.trim()) {
      throw new Error("each item must have a non-empty prompt");
    }
    if (
      item.aspectRatio !== undefined &&
      !(ASPECT_RATIOS as readonly string[]).includes(item.aspectRatio)
    ) {
      throw new Error(`invalid aspect_ratio: ${item.aspectRatio}`);
    }
    if (item.referenceImageUrl && item.referenceImageBase64) {
      throw new Error(
        "each item must use either reference_image_url OR reference_image_base64, not both",
      );
    }
  }

  // Half-price compute is still our compute — gate on the same global
  // rate limit. Reserve `items.length` against the hourly + daily caps.
  await checkRateLimit(params.items.length);

  // Pre-fetch / decode reference images. Cache by URL so a batch where
  // many items share one ref pays the network cost once.
  const refByUrl = new Map<string, ReferenceImage>();
  const itemRefs: Array<ReferenceImage | undefined> = [];
  for (const item of params.items) {
    if (item.referenceImageUrl) {
      const cached = refByUrl.get(item.referenceImageUrl);
      if (cached) {
        itemRefs.push(cached);
        continue;
      }
      const ref = await fetchReferenceImage(item.referenceImageUrl);
      refByUrl.set(item.referenceImageUrl, ref);
      itemRefs.push(ref);
    } else {
      itemRefs.push(await decodeReference(item));
    }
  }

  // Build the inline batch request payload.
  const requests = params.items.map((item, i) => ({
    request: {
      contents: [{ parts: buildRequestParts(item.prompt, itemRefs[i]) }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        ...(item.aspectRatio
          ? { imageConfig: { aspectRatio: item.aspectRatio } }
          : {}),
      },
    },
    metadata: { key: String(i) },
  }));

  const submitBody = {
    batch: {
      displayName:
        params.displayName ?? `dreamme-image-batch-${Date.now()}`,
      inputConfig: {
        requests: { requests },
      },
    },
  };

  const res = await fetch(BATCH_ENDPOINT(MODEL), {
    method: "POST",
    headers: {
      "x-goog-api-key": GOOGLE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(submitBody),
  });
  if (!res.ok) {
    throw new Error(
      `Gemini batch submit failed: ${res.status} ${await res.text()}`,
    );
  }
  const op = (await res.json()) as GeminiBatchOperation;
  if (!op.name) {
    throw new Error(`Gemini batch submit returned no resource name`);
  }
  const status = mapGeminiState(op.metadata?.state);

  const insert = await fetch(
    `${SUPABASE_URL}/rest/v1/image_generation_batches`,
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        gemini_batch_name: op.name,
        status,
        item_count: params.items.length,
        items: params.items,
        gemini_model: MODEL,
        source: params.source,
      }),
    },
  );
  if (!insert.ok) {
    throw new Error(
      `image_generation_batches insert failed: ${insert.status} ${await insert.text()}`,
    );
  }
  const inserted = (await insert.json()) as Array<{
    id: string;
    submitted_at: string;
  }>;
  const row = Array.isArray(inserted) ? inserted[0] : inserted;

  return {
    batchId: row.id,
    geminiBatchName: op.name,
    status,
    itemCount: params.items.length,
    geminiModel: MODEL,
    submittedAt: row.submitted_at,
    completedAt: null,
    items: params.items,
    results: null,
    error: null,
  };
}

export async function listImageBatches(params: {
  limit?: number;
  offset?: number;
}): Promise<ImageBatchSummary[]> {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);
  const url = `${SUPABASE_URL}/rest/v1/image_generation_batches?select=*&order=submitted_at.desc&limit=${limit}&offset=${offset}`;
  const res = await fetch(url, {
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `image_generation_batches list failed: ${res.status} ${await res.text()}`,
    );
  }
  const rows = (await res.json()) as BatchRow[];
  return rows.map(rowToSummary);
}

interface BatchRow {
  id: string;
  gemini_batch_name: string;
  status: BatchStatus;
  item_count: number;
  items: BatchItemInput[];
  results: BatchItemResult[] | null;
  gemini_model: string;
  source: "mcp" | "dashboard";
  submitted_at: string;
  completed_at: string | null;
  error: string | null;
}

async function loadBatchRow(batchId: string): Promise<BatchRow | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/image_generation_batches?id=eq.${batchId}&select=*`,
    { headers: supabaseHeaders(), cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(
      `image_generation_batches read failed: ${res.status} ${await res.text()}`,
    );
  }
  const rows = (await res.json()) as BatchRow[];
  return rows[0] ?? null;
}

async function persistBatchUpdate(
  batchId: string,
  patch: Partial<BatchRow>,
): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/image_generation_batches?id=eq.${batchId}`,
    {
      method: "PATCH",
      headers: { ...supabaseHeaders(), Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    throw new Error(
      `image_generation_batches update failed: ${res.status} ${await res.text()}`,
    );
  }
}

export async function getImageBatch(params: {
  batchId: string;
}): Promise<ImageBatchSummary> {
  const row = await loadBatchRow(params.batchId);
  if (!row) {
    throw new Error(`unknown batch: ${params.batchId}`);
  }

  // Cached terminal state — return immediately.
  if (
    row.status === "SUCCEEDED" ||
    row.status === "FAILED" ||
    row.status === "CANCELLED"
  ) {
    return rowToSummary(row);
  }

  // Poll Gemini for the latest state.
  const opRes = await fetch(BATCH_GET(row.gemini_batch_name), {
    headers: { "x-goog-api-key": GOOGLE_API_KEY },
    cache: "no-store",
  });
  if (!opRes.ok) {
    // Don't flip the row to failed on a transient infra error — surface
    // the Gemini error inline and leave status as-is for the next poll.
    return {
      ...rowToSummary(row),
      error: `Gemini poll failed: ${opRes.status} ${await opRes.text()}`,
    };
  }
  const op = (await opRes.json()) as GeminiBatchOperation;
  const newStatus = mapGeminiState(op.metadata?.state);

  if (newStatus !== "SUCCEEDED") {
    if (newStatus !== row.status) {
      await persistBatchUpdate(params.batchId, { status: newStatus });
      row.status = newStatus;
    }
    if (newStatus === "FAILED" || newStatus === "CANCELLED") {
      const errMsg = op.error?.message ?? "batch terminated";
      await persistBatchUpdate(params.batchId, {
        error: errMsg,
        completed_at: new Date().toISOString(),
      });
      row.error = errMsg;
      row.completed_at = new Date().toISOString();
    }
    return rowToSummary(row);
  }

  // SUCCEEDED — process inline responses.
  const inlined = op.response?.inlinedResponses?.inlinedResponses ?? [];
  const results: BatchItemResult[] = [];
  let totalImagesUploaded = 0;

  for (let i = 0; i < row.items.length; i++) {
    const item = row.items[i];
    const entry = inlined[i];
    const promptSnippet = item.prompt.slice(0, 80);
    const logFailure = (error: string) => {
      console.error(
        `[image-gen] batch ${params.batchId} item ${i + 1}/${row.items.length} failed: ${error}`,
        { promptSnippet, source: row.source },
      );
    };
    if (!entry) {
      const error = "no response from Gemini";
      logFailure(error);
      results.push({ prompt: item.prompt, error });
      continue;
    }
    if (entry.error) {
      const error =
        entry.error.message ??
        `Gemini item error code ${entry.error.code ?? "?"}`;
      logFailure(error);
      results.push({ prompt: item.prompt, error });
      continue;
    }
    const block = entry.response?.promptFeedback?.blockReason;
    if (block) {
      const error = `Gemini blocked: ${block}`;
      logFailure(error);
      results.push({ prompt: item.prompt, error });
      continue;
    }
    const parts = entry.response?.candidates?.[0]?.content?.parts ?? [];
    let inline: InlineData | undefined;
    for (const p of parts) {
      const v = p.inlineData ?? p.inline_data;
      if (v?.data) {
        inline = v;
        break;
      }
    }
    if (!inline?.data) {
      const error = "Gemini returned no image";
      logFailure(error);
      results.push({ prompt: item.prompt, error });
      continue;
    }
    try {
      const bytes = Buffer.from(inline.data, "base64");
      const mimeType = inline.mimeType ?? inline.mime_type ?? "image/png";
      const ext = extFromMime(mimeType);
      const id = randomId();
      const path = `${id}.${ext}`;
      const imageUrl = await uploadBytesToStorage(BUCKET, path, bytes, mimeType);
      const inserted = await insertRow({
        prompt: item.prompt,
        aspect_ratio: item.aspectRatio ?? null,
        image_url: imageUrl,
        gemini_model: row.gemini_model,
        source: row.source,
        reference_urls: item.referenceImageUrl ? [item.referenceImageUrl] : null,
      });
      results.push({
        prompt: item.prompt,
        imageUrl,
        imageGenerationId: inserted.id,
      });
      totalImagesUploaded += 1;
    } catch (err) {
      const error = (err as Error).message ?? "upload/insert failed";
      logFailure(error);
      results.push({ prompt: item.prompt, error });
    }
  }

  const completedAt = new Date().toISOString();
  await persistBatchUpdate(params.batchId, {
    status: "SUCCEEDED",
    results,
    completed_at: completedAt,
  });
  row.status = "SUCCEEDED";
  row.results = results;
  row.completed_at = completedAt;

  // One usage event per successfully-uploaded image, priced at the
  // batch (50%-off) rate. We don't have per-item token counts from
  // Gemini's batch response, so log 0 tokens — the per-image rate
  // dominates anyway.
  if (totalImagesUploaded > 0) {
    void logAiUsageEvent({
      vendor: "google",
      model: row.gemini_model,
      route: "/api/mcp/image#batch",
      inputTokens: 0,
      outputTokens: 0,
      imageCount: totalImagesUploaded,
      computedUsd: priceGeminiUsage({
        model: row.gemini_model,
        inputTokens: 0,
        outputTokens: 0,
        imageCount: totalImagesUploaded,
        isBatch: true,
      }),
      metadata: {
        source: row.source,
        batch_id: row.id,
        gemini_batch_name: row.gemini_batch_name,
      },
    });
  }

  return rowToSummary(row);
}

function rowToSummary(row: BatchRow): ImageBatchSummary {
  return {
    batchId: row.id,
    geminiBatchName: row.gemini_batch_name,
    status: row.status,
    itemCount: row.item_count,
    geminiModel: row.gemini_model,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    items: row.items,
    results: row.results,
    error: row.error,
  };
}
