/**
 * Self-hosted Streamable-HTTP MCP server.
 *
 * Auth supports two modes:
 *   1. Static bearer token via `MCP_IMAGE_BEARER_TOKEN` env var — simple
 *      path for Claude Code, which lets you set custom headers in its
 *      MCP client config.
 *   2. OAuth 2.1 with dynamic client registration + PKCE — required by
 *      claude.ai custom connectors, which don't accept static bearers.
 *      Tokens issued by /api/oauth/token after the user authorizes via
 *      /api/oauth/authorize. Discovery via /.well-known.
 *
 * We implement the JSON-RPC + Streamable-HTTP framing directly rather than
 * pulling in `@modelcontextprotocol/sdk` — the SDK's transports are built
 * around Node `IncomingMessage`/`ServerResponse` and don't fit cleanly
 * into Next.js App Router's Web Request/Response model.
 */
import { NextResponse } from "next/server";
import {
  ASPECT_RATIOS,
  MAX_REFERENCE_IMAGES,
  RateLimitError,
  generateImage,
  generateImageBatch,
  imageGenerationConfigured,
  type AspectRatio,
  type RefInput,
} from "@/lib/image-generation";
import { originFromRequest, validateBearer } from "@/lib/mcp-oauth";
import { parseProxyUploadArgs, proxyUpload } from "@/lib/proxy-upload";
import {
  getImageBatch,
  submitImageBatch,
  type BatchItemInput,
} from "@/lib/image-generation-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = {
  name: "dreamme-mcp-image",
  version: "1.0.0",
};

// Identifies the running deploy. Used as the SSE event id on the
// standalone GET stream so reconnecting clients can detect when their
// cached tools/list is stale (i.e. a redeploy happened) and we need to
// push notifications/tools/list_changed. See GET handler below.
const TOOLS_VERSION =
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.GIT_COMMIT ??
  `dev-${Date.now()}`;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
};
type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const TOOL_DEFINITION = {
  name: "generate_image",
  description:
    "Generate an image from a text prompt using Google Gemini. Returns a public URL pointing to the stored PNG/JPEG. Optionally accepts up to 4 reference images for image-to-image edits/composition — a single reference via image_url (or image_base64), or multiple via image_urls / images. Pass the URL of a previous output plus a prompt like \"make it green\" to iterate, or several references (e.g. a face + outfit + scene) to compose.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Text description of the image to generate (or the edit instruction when reference images are supplied).",
      },
      aspect_ratio: {
        type: "string",
        enum: [...ASPECT_RATIOS],
        description: "Optional aspect ratio. Defaults to 1:1.",
      },
      image_url: {
        type: "string",
        format: "uri",
        description:
          "Optional public http(s) URL of a single reference image (image-to-image). For multiple references use image_urls instead.",
      },
      image_base64: {
        type: "string",
        description:
          "Optional base64-encoded reference image bytes (alternative to image_url). Pair with image_mime_type when set.",
      },
      image_mime_type: {
        type: "string",
        enum: ["image/png", "image/jpeg", "image/webp", "image/gif"],
        description:
          "MIME type for image_base64. Defaults to image/png.",
      },
      image_urls: {
        type: "array",
        maxItems: 4,
        items: { type: "string", format: "uri" },
        description:
          "Optional array of up to 4 public http(s) reference image URLs. Combined with any image_url / images entries; total references capped at 4.",
      },
      images: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          required: ["base64"],
          properties: {
            base64: { type: "string" },
            mime_type: {
              type: "string",
              enum: ["image/png", "image/jpeg", "image/webp", "image/gif"],
            },
          },
        },
        description:
          "Optional array of up to 4 base64-encoded reference images (each { base64, mime_type }). Combined with any image_urls; total references capped at 4.",
      },
      count: {
        type: "integer",
        minimum: 1,
        maximum: 4,
        default: 1,
        description:
          "Number of variations to generate in parallel (1-4). When >1, the response carries N text content blocks (one URL per line) and structuredContent.images is an array. Each variation uses the same prompt and reference image.",
      },
    },
    required: ["prompt"],
  },
} as const;

const PROXY_UPLOAD_TOOL = {
  name: "proxy_upload",
  description:
    "Relay bytes from a public URL to an Azure Blob SAS upload URL. Mirrors POST /api/proxy/upload — useful when the caller's environment blocks direct egress to those hosts. source_url must be on *.supabase.co or *.blob.core.windows.net; upload_url must be on *.blob.core.windows.net. Returns { ok: true, bytes, status } on success.",
  inputSchema: {
    type: "object",
    properties: {
      source_url: {
        type: "string",
        format: "uri",
        description:
          "Public URL to GET. Host must end in .supabase.co or .blob.core.windows.net.",
      },
      upload_url: {
        type: "string",
        format: "uri",
        description:
          "Azure Blob SAS URL to PUT to. Host must end in .blob.core.windows.net.",
      },
      source_headers: {
        type: "object",
        description: "Optional headers to send on the GET.",
        additionalProperties: { type: "string" },
      },
      upload_headers: {
        type: "object",
        description:
          "Optional headers to send on the PUT (e.g. x-ms-blob-type, content-type).",
        additionalProperties: { type: "string" },
      },
    },
    required: ["source_url", "upload_url"],
  },
} as const;

const SUBMIT_IMAGE_BATCH_TOOL = {
  name: "submit_image_batch",
  description:
    "Submit a batch of image-generation requests to Gemini's async Batch API (50% off list price; 24h SLA, typically 2-6h). Returns a batch_id immediately. Poll with `get_image_batch` until status is SUCCEEDED. Use this for large jobs where you can wait hours for results; use `generate_image` for interactive single-call generations.",
  inputSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        description:
          "Up to 100 image requests. Each item carries the same fields as `generate_image`'s arguments (prompt + optional aspect_ratio + optional reference image).",
        items: {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: { type: "string" },
            aspect_ratio: {
              type: "string",
              enum: [...ASPECT_RATIOS],
            },
            image_url: { type: "string", format: "uri" },
            image_base64: { type: "string" },
            image_mime_type: {
              type: "string",
              enum: [
                "image/png",
                "image/jpeg",
                "image/webp",
                "image/gif",
              ],
            },
            image_urls: {
              type: "array",
              maxItems: 4,
              items: { type: "string", format: "uri" },
              description:
                "Up to 4 reference image URLs for this item (capped at 4 total references).",
            },
            images: {
              type: "array",
              maxItems: 4,
              items: {
                type: "object",
                required: ["base64"],
                properties: {
                  base64: { type: "string" },
                  mime_type: {
                    type: "string",
                    enum: [
                      "image/png",
                      "image/jpeg",
                      "image/webp",
                      "image/gif",
                    ],
                  },
                },
              },
              description:
                "Up to 4 base64 reference images for this item (capped at 4 total references).",
            },
          },
        },
      },
      display_name: {
        type: "string",
        description: "Optional human-readable label stored on Gemini's batch resource.",
      },
    },
    required: ["items"],
  },
} as const;

const GET_IMAGE_BATCH_TOOL = {
  name: "get_image_batch",
  description:
    "Fetch the status + (when ready) results of a `submit_image_batch` job. Status progresses PENDING -> RUNNING -> SUCCEEDED/FAILED/CANCELLED. When SUCCEEDED, `items[i]` contains image_url for each successful item; per-item errors are surfaced inline.",
  inputSchema: {
    type: "object",
    properties: {
      batch_id: {
        type: "string",
        description: "The batch_id returned from submit_image_batch.",
      },
    },
    required: ["batch_id"],
  },
} as const;

const ALL_TOOLS = [
  TOOL_DEFINITION,
  PROXY_UPLOAD_TOOL,
  SUBMIT_IMAGE_BATCH_TOOL,
  GET_IMAGE_BATCH_TOOL,
];

async function extractAndValidateBearer(req: Request): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  // Cap auth at 8s so a hung Supabase fetch can't eat the client's
  // tool-call budget. On timeout treat as unauthenticated and let the
  // client retry.
  return Promise.race<boolean>([
    validateBearer(match[1]),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), 8_000),
    ),
  ]);
}

function unauthorized(req: Request): Response {
  // Per RFC 9728 + the MCP auth spec, point clients at the protected-
  // resource metadata so they can discover the OAuth authorization server.
  const origin = originFromRequest(req);
  const resourceMetadata = `${origin}/.well-known/oauth-protected-resource/api/mcp/image`;
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer realm="mcp-image", resource_metadata="${resourceMetadata}"`,
    },
  });
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
}

function rpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

/**
 * Parse MCP reference-image args into a RefInput[]. Accepts both the
 * legacy single fields (image_url / image_base64 / image_mime_type) and
 * the multi-image array fields (image_urls / images). Returns an error
 * string on the first validation failure. `label` prefixes errors for
 * per-item batch context (e.g. "items[2].").
 */
function parseRefInputs(
  src: {
    image_url?: unknown;
    image_base64?: unknown;
    image_mime_type?: unknown;
    image_urls?: unknown;
    images?: unknown;
  },
  label = "",
): { refs: RefInput[] } | { error: string } {
  const refs: RefInput[] = [];
  const isHttp = (u: string) => {
    try {
      const p = new URL(u);
      return p.protocol === "http:" || p.protocol === "https:";
    } catch {
      return false;
    }
  };

  if (src.image_url !== undefined) {
    if (typeof src.image_url !== "string")
      return { error: `${label}image_url must be a string` };
    if (!isHttp(src.image_url))
      return { error: `${label}image_url must be http(s)` };
    refs.push({ url: src.image_url });
  }
  if (src.image_base64 !== undefined) {
    if (typeof src.image_base64 !== "string")
      return { error: `${label}image_base64 must be a base64-encoded string` };
    if (
      src.image_mime_type !== undefined &&
      typeof src.image_mime_type !== "string"
    )
      return { error: `${label}image_mime_type must be a string` };
    refs.push({
      base64: src.image_base64,
      mimeType: src.image_mime_type as string | undefined,
    });
  }
  if (src.image_urls !== undefined) {
    if (!Array.isArray(src.image_urls))
      return { error: `${label}image_urls must be an array` };
    for (const u of src.image_urls) {
      if (typeof u !== "string")
        return { error: `${label}image_urls entries must be strings` };
      if (!isHttp(u))
        return { error: `${label}image_urls entries must be http(s): ${u}` };
      refs.push({ url: u });
    }
  }
  if (src.images !== undefined) {
    if (!Array.isArray(src.images))
      return { error: `${label}images must be an array` };
    for (const im of src.images) {
      if (!im || typeof im !== "object")
        return { error: `${label}images entries must be objects` };
      const o = im as { base64?: unknown; mime_type?: unknown };
      if (typeof o.base64 !== "string")
        return { error: `${label}images[].base64 must be a string` };
      if (o.mime_type !== undefined && typeof o.mime_type !== "string")
        return { error: `${label}images[].mime_type must be a string` };
      refs.push({
        base64: o.base64,
        mimeType: o.mime_type as string | undefined,
      });
    }
  }
  if (refs.length > MAX_REFERENCE_IMAGES)
    return {
      error: `${label}too many reference images (max ${MAX_REFERENCE_IMAGES}, got ${refs.length})`,
    };
  return { refs };
}

async function handleGenerateImageStreaming(
  reqId: string | number | null,
  args: {
    prompt?: unknown;
    aspect_ratio?: unknown;
    image_url?: unknown;
    image_base64?: unknown;
    image_mime_type?: unknown;
    image_urls?: unknown;
    images?: unknown;
    count?: unknown;
  },
  progressToken: string | number | undefined,
): Promise<Response> {
  // Validate args up-front so we can short-circuit with a non-streaming
  // error response when something's wrong with the input.
  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  if (!prompt.trim()) {
    return formatResponse(
      rpcError(reqId, -32602, "prompt is required and must be a non-empty string"),
      true,
    );
  }
  const aspectRaw =
    typeof args.aspect_ratio === "string" ? args.aspect_ratio : undefined;
  const aspectRatio =
    aspectRaw && (ASPECT_RATIOS as readonly string[]).includes(aspectRaw)
      ? (aspectRaw as AspectRatio)
      : undefined;

  const parsedRefs = parseRefInputs(args);
  if ("error" in parsedRefs) {
    return formatResponse(rpcError(reqId, -32602, parsedRefs.error), true);
  }
  const referenceImages = parsedRefs.refs;

  let count = 1;
  if (args.count !== undefined) {
    if (typeof args.count !== "number" || !Number.isInteger(args.count)) {
      return formatResponse(rpcError(reqId, -32602, "count must be an integer"), true);
    }
    if (args.count < 1 || args.count > 4) {
      return formatResponse(rpcError(reqId, -32602, "count must be between 1 and 4"), true);
    }
    count = args.count;
  }

  if (!imageGenerationConfigured()) {
    return formatResponse(
      rpcError(reqId, -32002, "Image generation not configured on the server"),
      true,
    );
  }

  // Stream the response. While the Gemini call is running we send
  // `notifications/progress` every 10s. MCP clients that honor
  // `resetTimeoutOnProgress` (Claude Code, claude.ai connectors) will
  // hold the connection open instead of giving up at their default
  // 60s tool-call ceiling.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) => {
        controller.enqueue(
          encoder.encode(`event: message\ndata: ${JSON.stringify(obj)}\n\n`),
        );
      };

      // Always emit progress notifications. If the client didn't supply
      // a progressToken we synthesize one — technically off-spec, but
      // most MCP client SDKs reset the connection's read timer on any
      // inbound progress for the active JSON-RPC id. Worst case the
      // notification is silently dropped (no regression vs. omitting
      // entirely).
      const effectiveProgressToken = progressToken ?? crypto.randomUUID();

      let progress = 0;
      const startedAt = Date.now();
      const sendProgress = (message: string, total?: number) => {
        progress += 1;
        send({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: {
            progressToken: effectiveProgressToken,
            progress,
            ...(total !== undefined ? { total } : {}),
            message,
          },
        });
      };

      // Immediate first-byte progress to defeat proxy buffering and
      // make sure the client sees the stream is alive before any work
      // starts.
      sendProgress("Starting image generation…");

      // 5s ticker (was 10s) — halves worst-case wait for keep-alive
      // under any client-side tool timeout (e.g. Claude Code default
      // 60s).
      const ticker = setInterval(() => {
        const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
        sendProgress(`Generating image (${elapsedSec}s elapsed)…`);
      }, 5_000);

      try {
        const { results, errors } = await generateImageBatch({
          prompt,
          aspectRatio,
          referenceImages: referenceImages.length ? referenceImages : undefined,
          source: "mcp",
          count,
          // Generous server-side budget. Gemini 3.1 image preview can
          // take 60-120s; we hold the connection open via progress
          // notifications.
          timeoutMs: 240_000,
          onProgress: (completed, total) =>
            sendProgress(
              `Generated ${completed}/${total} image${total > 1 ? "s" : ""}`,
              total,
            ),
        });

        if (results.length === 0) {
          const message = errors[0]?.error ?? "image generation failed";
          send(rpcError(reqId, -32000, message, errors.length ? { errors } : undefined));
          return;
        }

        // Maintain back-compat: when only one image was successfully
        // produced, surface image_url at the top of structuredContent
        // (existing consumers read it). When more landed, also include
        // `images: [...]`. Per-item errors[] tags any slots that
        // failed so the caller can see partial failures.
        const single = results[0];
        const structuredContent =
          results.length === 1
            ? {
                image_url: single.imageUrl,
                id: single.id,
                aspect_ratio: single.aspectRatio,
                gemini_model: single.geminiModel,
                created_at: single.createdAt,
                reference_image_url: single.referenceImageUrl,
                errors: errors.length > 0 ? errors : undefined,
              }
            : {
                image_url: single.imageUrl,
                id: single.id,
                aspect_ratio: single.aspectRatio,
                gemini_model: single.geminiModel,
                created_at: single.createdAt,
                reference_image_url: single.referenceImageUrl,
                images: results.map((r) => ({
                  image_url: r.imageUrl,
                  id: r.id,
                  aspect_ratio: r.aspectRatio,
                  gemini_model: r.geminiModel,
                  created_at: r.createdAt,
                  reference_image_url: r.referenceImageUrl,
                })),
                errors: errors.length > 0 ? errors : undefined,
              };
        send(
          rpcResult(reqId, {
            content: results.map((r) => ({
              type: "text",
              text: r.imageUrl,
            })),
            structuredContent,
          }),
        );
      } catch (err) {
        if (err instanceof RateLimitError) {
          send(
            rpcError(reqId, -32003, err.message, {
              window: err.window,
              limit: err.limit,
            }),
          );
        } else {
          const message = (err as Error).message ?? "image generation failed";
          send(rpcError(reqId, -32000, message));
        }
      } finally {
        clearInterval(ticker);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tell Vercel/Nginx-style proxies not to buffer the SSE stream.
      "X-Accel-Buffering": "no",
    },
  });
}

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const method = req.method;

  // Notifications (no `id`) get no response.
  const isNotification = req.id === undefined || req.id === null;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      // tools.listChanged: true tells the SDK to open the standalone
      // GET SSE stream and listen for notifications/tools/list_changed.
      // We push that notification on a redeploy so cached tool lists
      // refresh without manual reconnect.
      capabilities: { tools: { listChanged: true } },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }

  if (method === "ping") {
    return rpcResult(id, {});
  }

  if (method === "tools/list") {
    return rpcResult(id, { tools: ALL_TOOLS });
  }

  if (method === "tools/call") {
    // `generate_image` is diverted to the streaming path in POST() before
    // reaching here. `proxy_upload` runs synchronously — the GET+PUT
    // round-trip is fast enough that progress notifications are
    // unnecessary.
    const params = (req.params ?? {}) as { name?: string; arguments?: unknown };
    if (params.name === "proxy_upload") {
      const parsed = parseProxyUploadArgs(params.arguments ?? {});
      if (!parsed.ok) {
        return rpcError(id, -32602, parsed.error);
      }
      const result = await proxyUpload(parsed.args);
      // MCP convention: surface a one-line text summary plus full
      // structuredContent. We don't reuse rpcError for upstream
      // failures — the caller will inspect ok=false in the result body.
      const summary = result.ok
        ? `ok bytes=${result.bytes} status=${result.status}`
        : `error ${result.error}${result.status !== undefined ? ` status=${result.status}` : ""}`;
      return rpcResult(id, {
        content: [{ type: "text", text: summary }],
        structuredContent: result,
        // Mirror MCP "tool error" convention so clients can render a
        // failure state without us throwing JSON-RPC -32xxx codes.
        isError: !result.ok,
      });
    }
    if (params.name === "submit_image_batch") {
      const args = (params.arguments ?? {}) as {
        items?: unknown;
        display_name?: unknown;
      };
      if (!Array.isArray(args.items)) {
        return rpcError(id, -32602, "items must be an array");
      }
      const items: BatchItemInput[] = [];
      for (let i = 0; i < args.items.length; i++) {
        const raw = args.items[i] as Record<string, unknown> | null;
        if (!raw || typeof raw !== "object") {
          return rpcError(id, -32602, `items[${i}] must be an object`);
        }
        if (typeof raw.prompt !== "string" || !raw.prompt.trim()) {
          return rpcError(
            id,
            -32602,
            `items[${i}].prompt is required and must be non-empty`,
          );
        }
        const aspectRaw = raw.aspect_ratio;
        let aspectRatio: AspectRatio | undefined;
        if (aspectRaw !== undefined) {
          if (
            typeof aspectRaw !== "string" ||
            !(ASPECT_RATIOS as readonly string[]).includes(aspectRaw)
          ) {
            return rpcError(
              id,
              -32602,
              `items[${i}].aspect_ratio must be one of ${ASPECT_RATIOS.join(", ")}`,
            );
          }
          aspectRatio = aspectRaw as AspectRatio;
        }
        const itemRefs = parseRefInputs(raw, `items[${i}].`);
        if ("error" in itemRefs) {
          return rpcError(id, -32602, itemRefs.error);
        }
        items.push({
          prompt: raw.prompt,
          aspectRatio,
          referenceImages: itemRefs.refs.length ? itemRefs.refs : undefined,
        });
      }
      try {
        const summary = await submitImageBatch({
          items,
          source: "mcp",
          displayName:
            typeof args.display_name === "string" ? args.display_name : undefined,
        });
        return rpcResult(id, {
          content: [
            {
              type: "text",
              text: `submitted batch ${summary.batchId} (${summary.itemCount} items, status=${summary.status})`,
            },
          ],
          structuredContent: {
            batch_id: summary.batchId,
            gemini_batch_name: summary.geminiBatchName,
            status: summary.status,
            item_count: summary.itemCount,
            gemini_model: summary.geminiModel,
            submitted_at: summary.submittedAt,
          },
        });
      } catch (err) {
        if (err instanceof RateLimitError) {
          return rpcError(id, -32003, err.message, {
            window: err.window,
            limit: err.limit,
          });
        }
        return rpcError(id, -32000, (err as Error).message ?? "submit failed");
      }
    }
    if (params.name === "get_image_batch") {
      const args = (params.arguments ?? {}) as { batch_id?: unknown };
      if (typeof args.batch_id !== "string" || !args.batch_id) {
        return rpcError(id, -32602, "batch_id is required");
      }
      try {
        const summary = await getImageBatch({ batchId: args.batch_id });
        const successCount =
          summary.results?.filter((r) => r.imageUrl).length ?? 0;
        return rpcResult(id, {
          content: [
            {
              type: "text",
              text: `batch ${summary.batchId} status=${summary.status}${
                summary.results
                  ? ` (${successCount}/${summary.itemCount} succeeded)`
                  : ""
              }`,
            },
          ],
          structuredContent: {
            batch_id: summary.batchId,
            gemini_batch_name: summary.geminiBatchName,
            status: summary.status,
            item_count: summary.itemCount,
            gemini_model: summary.geminiModel,
            submitted_at: summary.submittedAt,
            completed_at: summary.completedAt,
            error: summary.error,
            items: summary.items,
            results: summary.results,
          },
          isError: summary.status === "FAILED" || summary.status === "CANCELLED",
        });
      } catch (err) {
        return rpcError(
          id,
          -32000,
          (err as Error).message ?? "get_image_batch failed",
        );
      }
    }
    return rpcError(id, -32602, `Unknown tool: ${params.name ?? "<missing>"}`);
  }

  if (isNotification) return null;
  return rpcError(id, -32601, `Method not found: ${method}`);
}

function formatResponse(
  body: JsonRpcResponse | null,
  acceptsSse: boolean,
): Response {
  if (body === null) {
    // Notification-only — Streamable HTTP spec returns 202 Accepted.
    return new Response(null, { status: 202 });
  }
  if (acceptsSse) {
    const sse =
      `event: message\ndata: ${JSON.stringify(body)}\n\n`;
    return new Response(sse, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }
  return NextResponse.json(body, { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  if (!(await extractAndValidateBearer(req))) return unauthorized(req);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json(
      rpcError(null, -32700, "Parse error"),
      { status: 400 },
    );
  }

  const accept = req.headers.get("accept") ?? "";
  const acceptsSse = accept.includes("text/event-stream");

  // Batch (array) requests. Per JSON-RPC 2.0, respond with an array of
  // responses for the non-notification entries; if all are notifications,
  // respond with 202. Note: batched `generate_image` calls fall back to a
  // single-shot, non-streaming response (no progress notifications). MCP
  // clients we care about don't batch tool calls.
  if (Array.isArray(payload)) {
    const responses: JsonRpcResponse[] = [];
    for (const entry of payload) {
      const e = entry as JsonRpcRequest;
      if (
        e.method === "tools/call" &&
        ((e.params as { name?: string } | undefined)?.name === "generate_image")
      ) {
        // Synchronous fallback: invoke generateImage directly, no streaming.
        const callParams = e.params as {
          arguments?: {
            prompt?: unknown;
            aspect_ratio?: unknown;
            image_url?: unknown;
            image_base64?: unknown;
            image_mime_type?: unknown;
            image_urls?: unknown;
            images?: unknown;
          };
        };
        const id = e.id ?? null;
        try {
          const args = callParams.arguments ?? {};
          const prompt = typeof args.prompt === "string" ? args.prompt : "";
          if (!prompt.trim()) {
            responses.push(rpcError(id, -32602, "prompt is required"));
            continue;
          }
          const aspectRaw =
            typeof args.aspect_ratio === "string" ? args.aspect_ratio : undefined;
          const aspectRatio =
            aspectRaw && (ASPECT_RATIOS as readonly string[]).includes(aspectRaw)
              ? (aspectRaw as AspectRatio)
              : undefined;
          const parsedRefs = parseRefInputs(args);
          if ("error" in parsedRefs) {
            responses.push(rpcError(id, -32602, parsedRefs.error));
            continue;
          }
          const result = await generateImage({
            prompt,
            aspectRatio,
            referenceImages: parsedRefs.refs.length
              ? parsedRefs.refs
              : undefined,
            source: "mcp",
            timeoutMs: 240_000,
          });
          responses.push(
            rpcResult(id, {
              content: [{ type: "text", text: result.imageUrl }],
              structuredContent: {
                image_url: result.imageUrl,
                id: result.id,
                aspect_ratio: result.aspectRatio,
                gemini_model: result.geminiModel,
                created_at: result.createdAt,
                reference_image_url: result.referenceImageUrl,
              },
            }),
          );
        } catch (err) {
          if (err instanceof RateLimitError) {
            responses.push(
              rpcError(id, -32003, err.message, {
                window: err.window,
                limit: err.limit,
              }),
            );
          } else {
            responses.push(rpcError(id, -32000, (err as Error).message));
          }
        }
        continue;
      }
      const res = await handleRequest(e);
      if (res) responses.push(res);
    }
    if (responses.length === 0) {
      return new Response(null, { status: 202 });
    }
    if (acceptsSse) {
      const sse = responses
        .map((r) => `event: message\ndata: ${JSON.stringify(r)}\n\n`)
        .join("");
      return new Response(sse, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }
    return NextResponse.json(responses, { status: 200 });
  }

  // Special case: tools/call generate_image runs as a streaming response
  // so we can emit notifications/progress during the Gemini call. This
  // keeps MCP clients (claude.ai connectors, Claude Code) from giving
  // up at their default 60s tool-call ceiling.
  if (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as JsonRpcRequest).method === "tools/call"
  ) {
    const rpc = payload as JsonRpcRequest;
    const callParams = (rpc.params ?? {}) as {
      name?: string;
      arguments?: {
        prompt?: unknown;
        aspect_ratio?: unknown;
        image_url?: unknown;
        image_base64?: unknown;
        image_mime_type?: unknown;
      };
      _meta?: { progressToken?: string | number };
    };
    if (callParams.name === "generate_image") {
      return handleGenerateImageStreaming(
        rpc.id ?? null,
        callParams.arguments ?? {},
        callParams._meta?.progressToken,
      );
    }
  }

  const single = await handleRequest(payload as JsonRpcRequest);
  return formatResponse(single, acceptsSse);
}

export async function GET(req: Request): Promise<Response> {
  // Standalone server→client SSE stream. The SDK opens this after
  // `initialize` because we advertise tools.listChanged: true.
  //
  // Stateless: no Mcp-Session-Id. Each connection is independent.
  // We use the SSE `id:` field to carry the running deploy's
  // TOOLS_VERSION. On reconnect, the SDK echoes its last seen id back
  // as the `Last-Event-ID` header (per the SSE spec). When that
  // doesn't match the current TOOLS_VERSION, we know a redeploy
  // happened while the client was disconnected, and we push
  // notifications/tools/list_changed so the client refetches tools.
  //
  // Within a single deploy TOOLS_VERSION never changes, so subsequent
  // reconnects on the same deploy fire heartbeats only.
  if (!(await extractAndValidateBearer(req))) return unauthorized(req);

  const lastEventId = req.headers.get("last-event-id") ?? "";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      // Notify on first connect (no Last-Event-ID) AND on reconnect
      // when version differs (i.e. we're a fresher deploy than the
      // client last spoke to). Idempotent — extra `tools/list` calls
      // are cheap.
      if (lastEventId !== TOOLS_VERSION) {
        controller.enqueue(
          encoder.encode(
            `id: ${TOOLS_VERSION}\n` +
              `event: message\n` +
              `data: ${JSON.stringify({
                jsonrpc: "2.0",
                method: "notifications/tools/list_changed",
              })}\n\n`,
          ),
        );
      }

      // SSE comment heartbeats keep proxy/edge idle timers happy
      // without polluting the message stream. 25s is comfortably
      // under typical 30-60s idle ceilings.
      const ticker = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(ticker);
        }
      }, 25_000);

      // Vercel terminates the function at maxDuration regardless;
      // also bail when the request is aborted by the client.
      req.signal.addEventListener("abort", () => {
        clearInterval(ticker);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function DELETE(req: Request): Promise<Response> {
  // No session to terminate.
  if (!(await extractAndValidateBearer(req))) return unauthorized(req);
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
