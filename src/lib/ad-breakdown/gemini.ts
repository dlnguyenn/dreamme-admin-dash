/**
 * Ad breakdown · Gemini transport. Structured JSON output against a schema,
 * with the video inline when it fits and through the Files API when it
 * does not (uploaded 4K masters run 40-90 MB; inline requests cap near
 * 20 MB). Every call is capped with maxOutputTokens: uncapped, 3.8-flash
 * once ran away to 64k tokens on a 17-second clip.
 */
import { logAiUsageEvent } from "@/lib/vendors/ai-usage-logger";
import { priceGeminiUsage } from "@/lib/vendors/gemini-pricing";

const BASE = "https://generativelanguage.googleapis.com";
const INLINE_MAX_BYTES = 14 * 1024 * 1024;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 529]);

/** OUTLIER_-scoped first (a machine-wide GEMINI_API_KEY once shadowed the
 *  repo key), then the two names the two repos already use. */
export function geminiKey(): string {
  return process.env.OUTLIER_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "";
}

export function breakdownModel(): string {
  return process.env.AD_BREAKDOWN_GEMINI_MODEL ?? "gemini-3.8-flash";
}

export type VideoRef =
  | { kind: "inline"; data: string; mime: string }
  | { kind: "file"; uri: string; mime: string };

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Resumable upload to the Files API, then wait until the file is ACTIVE. */
async function uploadToFiles(bytes: Uint8Array, mime: string): Promise<string> {
  const key = geminiKey();
  const start = await fetch(`${BASE}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": key,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: `ad-breakdown-${Date.now()}` } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) throw new Error(`Gemini file upload start failed: ${start.status}`);
  const fin = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
      "Content-Type": mime,
    },
    body: bytes as BodyInit,
    signal: AbortSignal.timeout(180_000),
  });
  if (!fin.ok) throw new Error(`Gemini file upload failed: ${fin.status}`);
  const file = ((await fin.json()) as { file?: { name?: string; uri?: string; state?: string } }).file;
  if (!file?.name || !file.uri) throw new Error("Gemini file upload returned no file");
  let state = file.state;
  for (let i = 0; i < 40 && state === "PROCESSING"; i++) {
    await sleep(3000);
    const r = await fetch(`${BASE}/v1beta/files/${file.name.replace(/^files\//, "")}`, { headers: { "x-goog-api-key": key } });
    state = ((await r.json()) as { state?: string }).state;
  }
  if (state !== "ACTIVE") throw new Error(`Gemini file not ready (state ${state ?? "unknown"})`);
  return file.uri;
}

export async function prepareVideo(bytes: Uint8Array, mime: string): Promise<VideoRef> {
  if (bytes.byteLength <= INLINE_MAX_BYTES) {
    return { kind: "inline", data: Buffer.from(bytes).toString("base64"), mime };
  }
  return { kind: "file", uri: await uploadToFiles(bytes, mime), mime };
}

function videoPart(v: VideoRef) {
  return v.kind === "inline"
    ? { inline_data: { mime_type: v.mime, data: v.data } }
    : { file_data: { mime_type: v.mime, file_uri: v.uri } };
}

export async function geminiJson<T>(params: {
  video: VideoRef;
  prompt: string;
  schema: Record<string, unknown>;
  label: string;
  route?: string;
  temperature?: number;
  timeoutMs?: number;
}): Promise<{ data: T; usage: { input: number; output: number; seconds: number }; model: string }> {
  const key = geminiKey();
  if (!key) throw new Error("No Gemini key (set GOOGLE_API_KEY or OUTLIER_GEMINI_API_KEY)");
  const model = breakdownModel();
  const body = {
    contents: [{ parts: [videoPart(params.video), { text: params.prompt }] }],
    generationConfig: {
      response_mime_type: "application/json",
      response_json_schema: params.schema,
      temperature: params.temperature ?? 0.2,
      maxOutputTokens: 4096,
    },
  };
  let attempt = 0;
  for (const maxTok of [4096, 8192]) {
    body.generationConfig.maxOutputTokens = maxTok;
    while (true) {
      const t0 = Date.now();
      const res = await fetch(`${BASE}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(params.timeoutMs ?? 180_000),
      });
      if (!res.ok) {
        const text = await res.text();
        if (RETRYABLE.has(res.status) && attempt < 2) {
          attempt++;
          await sleep(Math.min(16_000, 1500 * 2 ** attempt));
          continue;
        }
        throw new Error(`Gemini ${params.label} ${res.status}: ${text.slice(0, 300)}`);
      }
      const j = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
        promptFeedback?: { blockReason?: string };
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      if (j.promptFeedback?.blockReason) throw new Error(`Gemini blocked the video (${j.promptFeedback.blockReason})`);
      const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
      const input = j.usageMetadata?.promptTokenCount ?? 0;
      const output = j.usageMetadata?.candidatesTokenCount ?? 0;
      void logAiUsageEvent({
        vendor: "google",
        model,
        route: params.route,
        inputTokens: input,
        outputTokens: output,
        imageCount: 0,
        computedUsd: priceGeminiUsage({ model, inputTokens: input, outputTokens: output, imageCount: 0 }),
        metadata: { label: params.label, maxTok },
      });
      try {
        return { data: JSON.parse(text) as T, usage: { input, output, seconds: (Date.now() - t0) / 1000 }, model };
      } catch {
        break; // truncated or malformed JSON: retry once with the larger cap
      }
    }
  }
  throw new Error(`Gemini ${params.label} returned unparseable JSON twice`);
}
