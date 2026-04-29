/**
 * Voyage AI embeddings client. Bare fetch, no SDK — matches the existing
 * Anthropic client pattern in src/lib/anthropic.ts.
 *
 * Model: voyage-3-lite, 1024 dimensions. Matches the vector(1024) columns
 * defined in supabase/migrations/0011_pgvector_families.sql.
 *
 * Voyage's batch limit is 128 inputs per request; this client transparently
 * batches inputs above that ceiling.
 */

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY ?? "";
const API = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3-large";
export const EMBEDDING_DIM = 1024;
const BATCH = 128;
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function voyageConfigured(): boolean {
  return !!VOYAGE_API_KEY;
}

export interface EmbedOptions {
  inputType?: "document" | "query";
  signal?: AbortSignal;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  apiKey?: string;
}

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

async function embedBatch(
  inputs: string[],
  opts: EmbedOptions,
): Promise<number[][]> {
  const apiKey = opts.apiKey ?? VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY not set");
  const f = opts.fetchImpl ?? fetch;
  const maxRetries = opts.maxRetries ?? 4;
  let attempt = 0;
  while (true) {
    const res = await f(API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        input: inputs,
        input_type: opts.inputType ?? "document",
      }),
      signal: opts.signal,
    });
    if (res.ok) {
      const data = (await res.json()) as VoyageResponse;
      const ordered = new Array<number[]>(inputs.length);
      for (const row of data.data ?? []) ordered[row.index] = row.embedding;
      return ordered;
    }
    const bodyText = await res.text();
    if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxRetries) {
      throw new Error(`Voyage error: ${res.status} ${bodyText}`);
    }
    const backoff = Math.min(16_000, 500 * Math.pow(2, attempt));
    const jitter = Math.floor(Math.random() * 250);
    await sleep(backoff + jitter);
    attempt++;
  }
}

export async function embed(
  texts: string[],
  opts: EmbedOptions = {},
): Promise<number[][]> {
  if (!texts.length) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const batch = await embedBatch(slice, opts);
    out.push(...batch);
  }
  return out;
}

export async function embedOne(
  text: string,
  opts: EmbedOptions = {},
): Promise<number[]> {
  const [v] = await embed([text], opts);
  return v;
}

/**
 * pgvector accepts text-format vector literals like "[1.0, 2.0, 3.0]".
 * PostgREST passes them through to Postgres which casts on insert.
 */
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export function parsePgVector(literal: string | null | undefined): number[] | null {
  if (!literal) return null;
  const trimmed = literal.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((s) => Number(s.trim()));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
