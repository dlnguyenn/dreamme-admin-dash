/**
 * Self-hosted Streamable-HTTP MCP server. claude.ai custom connectors and
 * Claude Code can both add this URL as an MCP server with bearer-token auth
 * and call the `generate_image` tool.
 *
 * We implement the JSON-RPC + Streamable-HTTP framing directly rather than
 * pulling in `@modelcontextprotocol/sdk` because the SDK's transports are
 * built around Node `IncomingMessage`/`ServerResponse` and don't fit
 * cleanly into the Next.js App Router's Web Request/Response model. The
 * surface we need (initialize, tools/list, tools/call) is small.
 *
 * Auth: every request must carry `Authorization: Bearer ${MCP_IMAGE_BEARER_TOKEN}`.
 * Stateless: no session IDs; each POST is self-contained.
 */
import { NextResponse } from "next/server";
import {
  ASPECT_RATIOS,
  RateLimitError,
  generateImage,
  imageGenerationConfigured,
  type AspectRatio,
} from "@/lib/image-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = {
  name: "dreamme-mcp-image",
  version: "1.0.0",
};

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
    "Generate an image from a text prompt using Google Gemini. Returns a public URL pointing to the stored PNG/JPEG. Useful for creating illustrations, mockups, marketing assets, or visual ideas on demand.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Text description of the image to generate.",
      },
      aspect_ratio: {
        type: "string",
        enum: [...ASPECT_RATIOS],
        description: "Optional aspect ratio. Defaults to 1:1.",
      },
      reference_image_urls: {
        type: "array",
        items: { type: "string", format: "uri" },
        maxItems: 3,
        description:
          "Optional public http(s) URLs (max 3) to reference images that condition the generation (style, subject, composition).",
      },
      count: {
        type: "integer",
        minimum: 1,
        maximum: 4,
        default: 1,
        description: "Number of variations to generate (1-4). Defaults to 1.",
      },
    },
    required: ["prompt"],
  },
} as const;

function checkAuth(req: Request): boolean {
  const expected = process.env.MCP_IMAGE_BEARER_TOKEN ?? "";
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  return match[1] === expected;
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ error: "unauthorized" }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": "Bearer",
      },
    },
  );
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

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const method = req.method;

  // Notifications (no `id`) get no response.
  const isNotification = req.id === undefined || req.id === null;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
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
    return rpcResult(id, { tools: [TOOL_DEFINITION] });
  }

  if (method === "tools/call") {
    const params = (req.params ?? {}) as {
      name?: string;
      arguments?: {
        prompt?: unknown;
        aspect_ratio?: unknown;
        reference_image_urls?: unknown;
        count?: unknown;
      };
    };
    if (params.name !== "generate_image") {
      return rpcError(id, -32602, `Unknown tool: ${params.name ?? "<missing>"}`);
    }
    const args = params.arguments ?? {};
    const prompt = typeof args.prompt === "string" ? args.prompt : "";
    if (!prompt.trim()) {
      return rpcError(id, -32602, "prompt is required and must be a non-empty string");
    }
    const aspectRaw =
      typeof args.aspect_ratio === "string" ? args.aspect_ratio : undefined;
    const aspectRatio =
      aspectRaw && (ASPECT_RATIOS as readonly string[]).includes(aspectRaw)
        ? (aspectRaw as AspectRatio)
        : undefined;

    let referenceImageUrls: string[] | undefined;
    if (args.reference_image_urls !== undefined) {
      if (!Array.isArray(args.reference_image_urls)) {
        return rpcError(id, -32602, "reference_image_urls must be an array of strings");
      }
      if (args.reference_image_urls.length > 3) {
        return rpcError(id, -32602, "reference_image_urls accepts at most 3 URLs");
      }
      const urls: string[] = [];
      for (const u of args.reference_image_urls) {
        if (typeof u !== "string") {
          return rpcError(id, -32602, "reference_image_urls entries must be strings");
        }
        try {
          const parsed = new URL(u);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return rpcError(id, -32602, `reference_image_urls must be http(s); got ${parsed.protocol}`);
          }
        } catch {
          return rpcError(id, -32602, `Invalid reference_image_urls entry: ${u}`);
        }
        urls.push(u);
      }
      referenceImageUrls = urls;
    }

    let count: number | undefined;
    if (args.count !== undefined) {
      if (typeof args.count !== "number" || !Number.isInteger(args.count)) {
        return rpcError(id, -32602, "count must be an integer");
      }
      if (args.count < 1 || args.count > 4) {
        return rpcError(id, -32602, "count must be between 1 and 4");
      }
      count = args.count;
    }

    if (!imageGenerationConfigured()) {
      return rpcError(id, -32002, "Image generation not configured on the server");
    }

    try {
      const { batchId, images } = await generateImage({
        prompt,
        aspectRatio,
        referenceImageUrls,
        count,
        source: "mcp",
      });
      // One text content block per generated image (URL on its own line)
      // is the most portable shape across MCP clients.
      return rpcResult(id, {
        content: images.map((img) => ({
          type: "text",
          text: img.imageUrl,
        })),
        structuredContent: {
          batch_id: batchId,
          images: images.map((img) => ({
            image_url: img.imageUrl,
            id: img.id,
            aspect_ratio: img.aspectRatio,
            gemini_model: img.geminiModel,
            created_at: img.createdAt,
            reference_urls: img.referenceUrls,
          })),
        },
      });
    } catch (err) {
      if (err instanceof RateLimitError) {
        return rpcError(id, -32003, err.message, {
          window: err.window,
          limit: err.limit,
        });
      }
      const message = (err as Error).message ?? "image generation failed";
      return rpcError(id, -32000, message);
    }
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
      },
    });
  }
  return NextResponse.json(body, { status: 200 });
}

export async function POST(req: Request): Promise<Response> {
  if (!checkAuth(req)) return unauthorized();

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
  // respond with 202.
  if (Array.isArray(payload)) {
    const responses: JsonRpcResponse[] = [];
    for (const entry of payload) {
      const res = await handleRequest(entry as JsonRpcRequest);
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
        },
      });
    }
    return NextResponse.json(responses, { status: 200 });
  }

  const single = await handleRequest(payload as JsonRpcRequest);
  return formatResponse(single, acceptsSse);
}

export function GET(req: Request): Response {
  // We don't support server-initiated streams in stateless mode. Bearer
  // check still applies so unauthenticated probes can't fingerprint the
  // endpoint shape.
  if (!checkAuth(req)) return unauthorized();
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export function DELETE(req: Request): Response {
  // No session to terminate.
  if (!checkAuth(req)) return unauthorized();
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
